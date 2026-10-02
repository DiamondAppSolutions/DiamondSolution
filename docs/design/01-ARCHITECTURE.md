# New Platform — Architecture & Stack Decision

Working name: **(unnamed — pick a brand later)**. Referred to below as "the platform." Same
functional surface as the old Diamond Solution app (MCQ exam-prep, courses/departments,
practice + leaderboard, affiliate/referral program, admin back office) — see that project's
`FUNCTIONAL_SPEC.md` for the full page-by-page feature list this platform carries over. This
set of documents is the **engineering redesign**: same product, rebuilt so the specific failure
modes that actually happened don't recur, and the shakiest business rules get a deliberate
second look (see `03-BUSINESS-RULES-REDESIGN.md`).

## Decisions locked in with the user

1. Plan first, create the repo once the plan is approved.
2. Backend/database: **Supabase** (managed Postgres + Auth + Storage + Realtime + Edge
   Functions) — chosen for being the least operational complexity that's still free at ~1,000
   users, and for replacing Firestore's rules model (the actual source of two real security
   bugs in the old app) with Postgres Row-Level Security.
3. Business rules get revisited, not just re-implemented as-is.

## Why Postgres/Supabase over "Firebase done right"

Both were on the table. The reason to move, specifically:

- **Firestore security rules are query-shape rules, not row rules.** `allow list` must be
  provably true for *every document a query could return*, or Firestore refuses the whole
  query. This is a subtle, easy-to-get-wrong model — it's exactly what produced two real
  incidents in the old app (a `users` list rule that read like a filter but was true for every
  valid document, i.e. "list everyone"; and a stray `|| true` that did the same thing, found
  only by diffing the *deployed* rules against the repo). **Postgres RLS policies are boolean
  expressions evaluated per row** by the query planner — there is no equivalent "this filter
  is accidentally universal" trap, because the database is filtering rows, not approving a
  query pattern in advance.
- **A real relational schema with constraints** replaces "whatever shape of document happened
  to get written" — foreign keys, `UNIQUE`, `CHECK`, and `NOT NULL` constraints catch bad
  writes at the database layer, before they ever reach a screen. The old `firebase-blueprint.json`
  already drifted from the real code within one project's lifetime (see the old README's
  Database section) specifically because Firestore has no schema enforcement at all — a
  blueprint is just documentation, never checked.
- **No collection-wide read-amplification trap.** The old app's two production outages were
  both "a live listener on a whole collection re-delivers everything to every open tab on every
  write anywhere." Postgres queries are explicit, indexed, and paginated by default — there is
  no implicit "whole table" read mode a component can accidentally fall into. Supabase Realtime
  subscriptions are opt-in per table/row-filter, used only where genuinely needed (chat,
  admin unread badges), not for lists or analytics.
- **One platform for Auth + DB + Storage + Realtime + server functions**, so there's no
  "service account JSON vs. Application Default Credentials vs. a non-default named database
  ID that must be passed explicitly everywhere" class of footgun (all three of which the old
  app's README had to document at length because they'd already caused confusion).
- **Free-tier fit at ~1,000 users**: Supabase's free project includes 500MB database storage,
  1GB file storage, 50,000 monthly active Auth users, 5GB uncached + 5GB cached egress/month,
  and 500,000 Edge Function invocations/month. A question bank + 1,000 active students'
  practice history and chat threads fits comfortably inside that, *especially* once images move
  out of the database (see below) and queries are indexed/paginated from day one instead of
  "fetch the whole collection and filter in JS," which is what actually burned through the old
  app's quota. **One real free-tier operational risk to plan around, not discover later**: a
  free Supabase project **pauses itself after 7 days with no activity** and has to be manually
  unpaused from the dashboard — fine once real users are active daily, but worth a trivial daily
  keep-alive ping (or just awareness) during early development/testing gaps, and a clear
  decision point for moving to the paid tier before a real launch if that's a concern.
- **One thing the free tier does *not* give us**: Supabase Auth's built-in session controls
  ("single session per user," time-boxed sessions, inactivity timeout) are **Pro-plan and up**,
  and even on Pro, "single session per user" only supports a strict cap of exactly 1, not a
  configurable N. Since the business-rules redesign wants a configurable cap (default 2, see
  `03-BUSINESS-RULES-REDESIGN.md` §2), **the session cap is custom-built**, not a Supabase
  setting we flip on — see `05-BACKEND.md` for exactly how. This is a deliberate build-vs-buy
  call made with the free-tier constraint in mind, not an oversight.

## System components

```
┌─────────────────────────┐        ┌───────────────────────────────┐
│   Frontend (Vite SPA)    │──────▶│        Supabase project         │
│   React + TS + Tailwind  │        │  ┌───────────┐  ┌────────────┐ │
│   react-router-dom       │◀──────│  │  Postgres  │  │    Auth    │ │
│   deployed to Cloudflare  │  RLS- │  │ (RLS-gated)│  │ (email+pw, │ │
│   Pages free tier         │ gated │  └───────────┘  │  MFA/TOTP, │ │
└─────────────┬────────────┘ direct │  ┌───────────┐  │  passkeys) │ │
              │                queries│  │  Storage  │  └────────────┘ │
              │ privileged ops only  │  │ (images,  │  ┌────────────┐ │
              ▼                      │  │  receipts)│  │  Realtime  │ │
┌─────────────────────────┐          │  └───────────┘  │ (chat, few │ │
│   Edge Functions (Deno)  │─────────▶                  │ live rows) │ │
│   - payment verify/webhook│ service  └───────────────┘────────────┘ │
│   - payout initiation     │  role                                   │
│   - OTP issue/verify       │  key                                   │
│   - admin destructive ops  │                                        │
│   - device/session policy  │                                        │
│   - WhatsApp notify, Gemini│                                        │
│     translate (optional)   │                                        │
└─────────────┬───────────┘        └────────────────────────────────┘
              │
              ▼
   ┌───────────────────┐
   │ External services   │
   │ Paystack (+ optional │
   │ Flutterwave), Brevo   │
   │ (email), Meta WhatsApp│
   │ Cloud API, Gemini API │
   │ (optional translate)  │
   └───────────────────┘
```

**Frontend talks to Postgres directly** (via Supabase's auto-generated PostgREST API / client
SDK) for anything RLS can safely gate on its own: reading courses/questions a user has access
to, writing their own `study_progress`/`question_attempts`, reading their own notifications,
etc. This removes most of the old app's hand-rolled `/api/*` surface — RLS *is* the
authorization layer, enforced by Postgres itself, not by an Express middleware the client has
to trust.

**Edge Functions are the only path to anything money-moving, identity-sensitive, or requiring
a third-party secret** — the direct analogue of the old app's "server is the only thing that
writes `payments`/`affiliates`/`balance`" pattern, which was already correct there and is kept:

| Function | Replaces | Why it must be server-only |
|---|---|---|
| `verify-payment` | `/api/verify-departmental-payment`, `/api/verify-reactivation-payment` | Needs `PAYSTACK_SECRET_KEY`; must independently re-verify amount/currency/reference before granting access. |
| `paystack-webhook` | (new — the old app never had a webhook, only reference-verify) | Paystack signs webhook payloads with a secret; this is a stronger, push-based confirmation path, used as the primary success signal with reference-verify kept as a fallback/reconciliation path. |
| `request-otp` / `verify-otp` | `/api/otp/request`, `/api/otp/verify` | Needs to hash codes, send email, and sign a short-lived step-up token. |
| `admin-action` | the admin "Security Clearance" OTP flow + the various admin-only writes (delete user, approve payout, change role) | Needs the `service_role` key to bypass RLS for the specific, audited mutation; verifies the step-up token first. |
| `request-payout` | `/api/payout` | Needs Paystack Transfer API secret; recomputes the real balance server-side before paying out. |
| `register-session` | the client-side `registeredDeviceIds`/device-block logic in `Login.tsx` | Must run server-side, with the `service_role` key, immediately after sign-in — not a Supabase-managed hook (that tier of control is Pro-only and only supports a strict 1-session cap anyway). See `05-BACKEND.md` for the exact mechanism. |
| `notify-admin-whatsapp`, `translate` | `/api/whatsapp/notify-admin`, `/api/translate` | Third-party API secrets (Meta, Gemini); optional/best-effort, not security-critical. |

This is a **smaller surface than the old Express app's `/api/*` routes**, not a bigger one —
most of what used to be a hand-rolled endpoint (e.g. `/api/public-profiles`, to avoid exposing
a whole `users` document just to show a name) is now just a narrower Postgres `view` with its
own RLS policy, since the database can enforce "only non-sensitive columns" directly.

## Deployment model (simpler than the old app's)

The old app had to maintain **two parallel entry points for one Express app**
(`server.ts` for a long-running process, `netlify/functions/api.ts` wrapping the same app in
`serverless-http` for Netlify) specifically because Netlify can't run a persistent Node
process. That whole problem disappears here:

- **Frontend**: a static Vite build, deployed to Cloudflare Pages' free tier as a plain
  static site (no functions needed on that side at all — moved off Netlify after its team
  ran out of operational credits and auto-deploys stalled).
- **Backend**: Supabase Edge Functions, deployed via the Supabase CLI (`supabase functions
  deploy`) directly to Supabase's own edge network — no second hosting target, no
  serverless-wrapping shim, no "does this time out at 10s on the free tier" surprise (Supabase
  Edge Functions run on Deno Deploy's infrastructure with a more generous default timeout, and
  the function count that matters, 500k/month, is tracked in one dashboard).
- **Database**: nothing to provision beyond creating the Supabase project — migrations are
  plain `.sql` files under version control, applied via `supabase db push` (or in CI), which
  also solves the old app's "editing `firestore.rules` locally doesn't touch the live database,
  and nothing warns you when they drift" problem: migrations are the only way schema or RLS
  policy changes reach the live database, and `supabase db diff`/`db dump` lets CI verify the
  deployed state matches the repo before every merge.

## What stays identical to the old app on purpose

- **Paystack as the payment gateway** (NGN-first market fit for the target audience), with the
  server-side-verification pattern kept — that part of the old design was already correct.
- **The overall page/feature list** — dashboard, timed practice with resume, department-gated
  course catalog, leaderboard, activity log, affiliate dashboard, notifications, support chat,
  and a tabbed admin back office. See `04-FEATURE-PARITY.md` for the page-by-page carry-over
  and the few deliberate additions/removals.
- **Two supported UI languages (English/French)** and the general two-currency (NGN/USD) model.

## What changes architecturally (summary — see `02-DATA-MODEL-AND-SECURITY.md` for detail)

- Relational schema with real constraints, replacing loosely-typed Firestore documents.
- Postgres RLS + a reviewable, CI-tested policy set, replacing hand-reasoned Firestore rules
  and a manual "Dirty Dozen" checklist.
- Real object storage for images (Supabase Storage), replacing base64-in-document.
- Role via a dedicated `user_roles` table resolved by a SQL function, replacing a hardcoded
  super-admin email baked into client *and* rules *and* three other files.
- Server-tracked sessions (a real `login_sessions` table), replacing a client-generated,
  trivially-clearable `localStorage` device ID as the thing a security policy depends on.
- One shared OTP/step-up-auth implementation, replacing two independently duplicated copies.
- Every previously hardcoded number (device cap, lockout hours, fees, commission rate, FX
  fallback, password policy, daily question goal) lives in an admin-editable settings table.
