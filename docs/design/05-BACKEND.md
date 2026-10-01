# Backend Deep Dive — Edge Functions

This expands the function table in `01-ARCHITECTURE.md` into the thing you'd actually build
from: project layout, exactly what each function does, how auth/secrets/rate-limiting work,
and the session-eviction mechanism in full (corrected after checking Supabase's actual current
docs — see the callout in §3).

## 1. Runtime & project layout

Edge Functions run on Deno, deployed per-function via the Supabase CLI. One function = one
focused responsibility (deliberately not one big dispatch-by-action-type function — that
pattern is exactly how the old app's single 5,194-line `AdminDashboard.tsx` became hard to
maintain, and it's just as easy to recreate on the backend as a mega-function with a giant
switch statement).

```
supabase/
  migrations/              -- plain .sql files, the only way schema/RLS ever changes
  functions/
    _shared/
      auth.ts              -- verifyUser(req) -> {id, email, roles}; verifyServiceCaller()
      rate-limit.ts        -- checkRateLimit(key, limit, windowSeconds)
      paystack.ts           -- thin fetch wrapper for Paystack's REST API
      otp.ts                -- hashCode(), issueOtp(), verifyOtp() shared by every step-up flow
      email.ts              -- Brevo client wrapper
    register-session/
    verify-payment/
    paystack-webhook/
    request-payout/
    admin-manage-user/
    admin-process-withdrawal/
    admin-approve-commission/
    request-otp/
    verify-otp/
    change-password/
    translate/
    notify-admin-whatsapp/
    whatsapp-webhook/
  seed/
    00-bootstrap-admin.sql
  tests/
    pgtap/                 -- RLS invariant tests, run in CI
    functions/              -- Deno test files per function, run in CI
```

## 2. Auth pattern (every function, except webhooks)

Every Edge Function except the two webhook receivers (`paystack-webhook`,
`whatsapp-webhook` — which authenticate via provider signature headers, not a user session)
starts the same way:

```ts
// _shared/auth.ts
export async function verifyUser(req: Request) {
  const authHeader = req.headers.get("Authorization");
  const jwt = authHeader?.replace("Bearer ", "");
  const { data, error } = await supabaseAnon.auth.getUser(jwt);
  if (error || !data.user) throw new HttpError(401, "Not authenticated");
  return data.user; // { id, email, ... }
}
```

The function then uses a **`service_role`-keyed Postgres client for the actual privileged
write** (bypassing RLS deliberately, the same bypass concept as the old app's Admin SDK), after
checking whatever authorization the specific action needs (ownership, `is_admin()`, a verified
step-up token). The `service_role` key lives only in Supabase's own function secrets store
(`supabase secrets set SERVICE_ROLE_KEY=...`), never in a repo, never sent to the client.

## 3. Session registration & the concurrent-session cap (corrected design)

**What I originally sketched assumed Supabase's built-in session controls would do this.
Checked against Supabase's actual current docs: "single session per user," time-boxed
sessions, and inactivity timeout are all Pro-plan and up, and even on Pro, "single session"
only supports a strict cap of 1 — never a configurable N. Since we're targeting the free tier
and want a configurable cap (default 2), none of that applies. Here's the design that actually
works on the free tier:**

**Flow:**
1. Client signs in via `supabase.auth.signInWithPassword(...)` as normal (unauthenticated
   REST call to Supabase Auth — no custom code needed here).
2. Immediately after, the client calls the `register-session` Edge Function with its new
   access token.
3. `register-session` (using `service_role`):
   - Inserts a row into `login_sessions` for this sign-in, storing the Auth session's own
     `session_id` (present in the JWT's claims) alongside our metadata (device label from
     user-agent, IP, timestamps).
   - Counts non-revoked `login_sessions` rows for this user.
   - If over `app_settings.max_concurrent_sessions` (default 2), picks the oldest surplus
     session(s) and **deletes their corresponding row(s) directly from `auth.sessions`** (the
     Postgres table Supabase Auth itself reads/writes, reachable because the function holds
     the `service_role` key) — then marks them `revoked_at` in our own `login_sessions` table
     too, for the audit trail.
   - Also appends one row to `login_events` for the visit-frequency/peak-hours analytics,
     same purpose as the old app's `login_events`.

**What "revoked" actually means, precisely — because overclaiming this was a mistake worth
correcting rather than repeating:** Supabase access tokens are **stateless JWTs**. Deleting a
session's row from `auth.sessions` stops that session's **refresh token** from working on its
next renewal — it does **not** instantly invalidate an access token already in the evicted
browser's hands, which stays valid until its own `exp` (Supabase's default JWT lifetime is on
the order of an hour). In practice: the evicted device keeps working for up to that long, then
is forced to sign in again once its access token expires and the refresh fails. This is the
honest version of "signed out on your other device" — close to instant, not literally instant.
**If a specific flow genuinely needs instant revocation** (e.g., an admin suspending a user
for cause, where "a few minutes of continued access" is unacceptable), the stronger pattern is
a Custom Access Token Hook that embeds the Auth session's `session_id` as a JWT claim, and a
check in that specific sensitive path (e.g. inside `has_department_access()` or the
`admin-manage-user` function) that the claimed `session_id` still exists in `auth.sessions`
before proceeding — effectively a real-time revocation check on the specific operations that
need it, without needing it on every single request. Build the simple version first; add this
only where a concrete flow needs it.

## 4. Rate limiting (no `express-rate-limit` equivalent exists for Edge Functions)

The old app used `express-rate-limit` in front of `/api/otp/request` etc. Edge Functions have
no built-in per-caller rate limiter, so this is a small shared Postgres-backed helper:

```sql
create table rate_limit_hits (
  bucket_key text not null,     -- e.g. 'otp:' || user_id, or 'otp-ip:' || ip
  window_start timestamptz not null,
  hit_count int not null default 1,
  primary key (bucket_key, window_start)
);
```
`_shared/rate-limit.ts` increments the current window's row (`on conflict do update ... hit_count
+ 1`) and rejects with 429 once `hit_count` exceeds the configured limit for that bucket. Used
on `request-otp` (per-user and per-IP), `verify-otp` (per-user, to slow brute-forcing a 6-digit
code), and `register-session` (per-user, so a scripted sign-in loop can't be used to repeatedly
evict a real session). A scheduled job prunes old window rows daily.

## 5. Endpoint reference

| Function | Auth | Request | What it does |
|---|---|---|---|
| `register-session` | user JWT | `{}` (session id comes from the JWT itself) | Records the session, evicts oldest beyond `max_concurrent_sessions`, logs a `login_events` row. Called once, right after sign-in. |
| `verify-payment` | user JWT | `{reference, purpose, department_id?}` | Looks up/confirms the `payments` row (webhook may have already landed it), re-verifies with Paystack if not yet confirmed, writes `access_grants` + a `commissions` row if the buyer was referred. Idempotent on `(provider, provider_reference)`. |
| `paystack-webhook` | Paystack signature header (`x-paystack-signature`, HMAC-SHA512 of the raw body against `PAYSTACK_SECRET_KEY`) | Paystack's event payload | The primary, push-based confirmation path for a successful charge — does the same write `verify-payment` does, so whichever of the two reaches "success" first wins; the unique constraint on `provider_reference` makes the second arrival a no-op, not a duplicate grant. |
| `request-payout` *(admin-triggered; the student's own withdrawal **request** is a direct RLS-protected insert, no function needed)* | admin JWT + verified step-up token | `{withdrawal_id, decision: 'approve'\|'reject', otp_token}` | On approve: calls Paystack's Transfer Recipient + Transfer APIs with the user's saved `payout_methods` row, updates `withdrawals.status`. On reject: just updates status with a reason. |
| `admin-manage-user` | admin JWT + verified step-up token | `{action: 'suspend'\|'unsuspend'\|'change_role'\|'delete', target_user_id, otp_token, reason?, new_role?}` | Applies the change via `service_role` (role changes go through `user_roles`, never a client-writable column); `delete` calls Supabase's Admin API to remove the Auth user (cascades to owned rows via `on delete cascade`). Writes one `admin_actions_log` row per call. |
| `admin-process-withdrawal` | *(folded into `request-payout` above — kept as one function, not two, since "approve" and "reject" are the same action-class)* | — | — |
| `admin-approve-commission` | admin JWT + verified step-up token | `{commission_id, otp_token}` | Marks a commission `status = 'paid'` (bookkeeping only — the actual money movement to the user's bank is the separate withdrawal/payout flow above). |
| `request-otp` | user JWT | `{purpose: 'password_change'\|'admin_step_up', target_id?}` | Generates a 6-digit code, stores only its hash in `security_otp_tokens`, emails it to the caller's **own** verified address (never a hardcoded recipient), rate-limited. |
| `verify-otp` | user JWT | `{purpose, code}` | Checks the hash + expiry + not-already-consumed, marks consumed, returns a short-lived (15 min) signed token the caller must present to the actual sensitive action next. |
| `change-password` | user JWT + verified step-up token | `{new_password, otp_token}` | Re-checks the step-up token, then updates the password via the Admin API (so the policy is enforced server-side even if a client tried to call Supabase Auth's own `updateUser` directly and skip the OTP step). |
| `translate` | admin/moderator JWT | `{question_id, target_lang: 'fr'}` | Calls Gemini, writes the result into `question_translations` (cached — generated once per question, not re-called on every student view like the old app did). |
| `notify-admin-whatsapp` | user JWT | `{message}` | Best-effort push to the admin's WhatsApp via Meta's Cloud API when a student sends a chat message; failure is logged, never blocks the chat message itself from saving. |
| `whatsapp-webhook` | Meta's verify-token handshake (GET) / signature header (POST) | Meta's webhook payload | Routes an admin's WhatsApp reply back into the right `chat_messages` row. |

Everything *not* in this table — reading courses a user has access to, writing their own
`study_progress`/`question_attempts`, reading their own notifications, requesting a withdrawal,
reading the admin dashboard's tables — goes **directly from the client to Postgres** through
Supabase's client library, authorized entirely by RLS. That's the whole point of choosing
Postgres+RLS: most of what used to need a hand-written endpoint just to re-check permissions
the database could already enforce on its own, no longer does.

## 6. Local development & testing

- `supabase start` runs the full stack locally (Postgres, Auth, Storage, Realtime, Edge
  Functions runtime) in Docker — the same migrations and functions run locally as in
  production, so "works on my machine" and "works deployed" use the identical schema/RLS.
- `supabase functions serve <name> --env-file .env.local` for iterating on one function with
  hot reload; `.env.local` holds the same secret names Supabase's hosted secrets store will
  hold in production (`PAYSTACK_SECRET_KEY`, `BREVO_API_KEY`, `WHATSAPP_TOKEN`,
  `GEMINI_API_KEY`, etc.), never committed.
- Deno's built-in test runner (`deno test`) covers each function's request validation and
  business logic against a local Supabase instance; pgTAP (`supabase/tests/pgtap/`) covers
  every RLS invariant (the Dirty-Dozen successor from `02-DATA-MODEL-AND-SECURITY.md` §8).
  Both run in CI on every pull request — a function or a policy change can't merge without its
  test passing, which is the structural fix for "the old app's rules only got manually
  re-checked when someone remembered to."

## 7. Observability

- Supabase's dashboard gives function invocation counts/logs and DB metrics out of the box —
  enough to watch free-tier headroom without adding anything.
- Sentry's free tier wraps each Edge Function's entry point (a few lines in `_shared/`) to
  catch and report unhandled errors with the request context, replacing "an error only visible
  if someone happens to check `console.error` output."
- `admin_actions_log` is the audit trail for every privileged mutation — who did what, when,
  to what target — queryable directly by admins, no separate log-shipping needed at this scale.
