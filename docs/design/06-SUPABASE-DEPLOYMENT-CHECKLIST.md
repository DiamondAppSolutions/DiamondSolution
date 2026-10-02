# Supabase deployment checklist (do this once you're back on your laptop)

Nothing built so far has reached your live Supabase project — every migration has only been
validated against a throwaway local Postgres instance. This is the full list of what's left to
actually go live, in order. Each step says which tool does it and roughly how long it takes.

## 0. Rotate the leaked access token first

You pasted a live Supabase personal access token into this chat earlier
(`sbp_fc860887b5...`). I never used or stored it (the host it talks to is blocked from this
sandbox), but it was typed into a chat transcript regardless, so treat it as compromised:

- Supabase dashboard → your account menu → **Access Tokens** → revoke that token → generate a
  fresh one if you still need CLI login.

## 1. Install the CLI and log in

```bash
npm install -g supabase   # or: npx supabase <command> every time, no global install needed
supabase login             # opens a browser to authenticate
```

## 2. Create the Supabase project (if you haven't already)

Dashboard → **New project** → pick a region close to your users (e.g. closest to Nigeria is
usually `eu-west` or similar — check the lowest-latency option Supabase offers) → note the
**project ref** (the short string in the project URL, `xxxxxxxxxxxx`).

## 3. Link the repo to the project and push the schema

```bash
cd diamondsolution
supabase link --project-ref <your-project-ref>
supabase db push             # applies all 6 migrations, in order, to the live project
```

This creates every table, RLS policy, and function from scratch — `profiles`, `departments`,
`courses`, `questions`, `payments`, `access_grants`, `study_progress`, `question_attempts`,
`daily_practice_stats`, the affiliate/referral/payout tables, `notifications`, and all their
RLS policies and helper functions (`is_admin()`, `leaderboard()`, `record_question_attempt()`,
etc.). Since no real users exist on the live project yet, this is a clean push — nothing to
migrate or backfill.

## 4. Set Edge Function secrets

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically
by Supabase — nothing to do for those. The one secret you do need to set by hand:

```bash
supabase secrets set PAYSTACK_SECRET_KEY=sk_test_xxxxxxxxxxxx
```

Start with your Paystack **test** secret key so you can do a full dry run before touching real
money. Get it from the Paystack dashboard → Settings → API Keys & Webhooks.

## 5. Deploy the Edge Functions

```bash
supabase functions deploy verify-payment
supabase functions deploy paystack-webhook
supabase functions deploy request-payout
```

(`_shared/` is bundled automatically into each function — no separate deploy step for it.)

## 6. Register the Paystack webhook

Paystack dashboard → Settings → API Keys & Webhooks → **Webhook URL**:

```
https://<your-project-ref>.supabase.co/functions/v1/paystack-webhook
```

This is what makes payment confirmation work even if a student closes the tab right after
paying — the client-triggered `verify-payment` call and this webhook both land on the same
idempotent `processDepartmentAccessPayment`, so whichever arrives first wins and the second is
a safe no-op.

## 7. Configure Auth URLs

Dashboard → **Authentication** → **URL Configuration**:

- **Site URL**: your Netlify domain, e.g. `https://diamondsolutionapp.netlify.app`
- **Redirect URLs**: add the same domain (and any Netlify preview-deploy URL pattern you use)

Without this, the email-confirmation link a new user receives redirects to `localhost` instead
of your real site.

## 8. Set Netlify environment variables and redeploy

Netlify site → **Site configuration** → **Environment variables**, set:

- `VITE_SUPABASE_URL` — from Supabase dashboard → Project Settings → API
- `VITE_SUPABASE_ANON_KEY` — same page
- `VITE_PAYSTACK_PUBLIC_KEY` — Paystack dashboard, the `pk_test_...` key to match the secret
  key from step 4

These are baked in at **build time**, not read at runtime — after setting them, trigger a new
deploy (Netlify → Deploys → **Trigger deploy**), a page refresh alone won't pick them up. This
is also the actual fix for the blank-page issue you saw before — that was these variables being
unset, and `src/main.tsx` now shows a clear "Configuration missing" message instead of a blank
screen if they're ever missing again.

## 9. Bootstrap your own admin account

1. Sign up for an account normally through the live, deployed app.
2. Supabase dashboard → **Authentication** → **Users** → click your account → copy its **User
   UID**.
3. Open `supabase/seed/00-bootstrap-admin.sql`, replace `YOUR-USER-ID-HERE` with that UID.
4. Run it in Supabase dashboard → **SQL Editor** → New query → paste → Run.
5. Sign out and back in on that account (role is read fresh on sign-in).

## 10. Seed real content

Through the now-unlocked `/admin` screens: create at least one department (with
`department_pricing`), a course, and either hand-enter questions or use the CSV import on the
Questions tab if you have the old app's exported question bank.

## 11. End-to-end smoke test (Paystack test mode)

- Sign up a second (non-admin) test account.
- Browse departments, pick one, pay with a Paystack **test card**
  (`4084084084084081`, any future expiry, any CVV).
- Confirm: a row appears in `payments` with `status = success`, a row in `access_grants`, the
  course unlocks in the UI, and a "Payment received" notification shows up (bell icon).
- In `/admin/payments`, confirm the transaction shows as success.
- If you set up a referral code first and sign the test account up via that link, confirm a
  `commissions` row and a "You earned a commission" notification appear on the referrer's
  account once the payment succeeds.

## 12. Go live with real payments

Once the test-mode run above is clean:

```bash
supabase secrets set PAYSTACK_SECRET_KEY=sk_live_xxxxxxxxxxxx
```

Update `VITE_PAYSTACK_PUBLIC_KEY` in Netlify to the matching `pk_live_...` key, redeploy, and
update the Paystack webhook URL registration if Paystack treats test/live as separate webhook
configs (check the Paystack dashboard — it usually doesn't, but worth a glance). Do one real,
low-value transaction yourself post-deploy to confirm the live keys work end-to-end before
telling anyone else the platform is open.

---

Everything above is a one-time setup. After this, the only recurring step is `supabase db
push` whenever a new migration lands in `supabase/migrations/`, and `supabase functions
deploy <name>` whenever an Edge Function changes — both already covered by the regular
workflow this session has been using (I validate locally against throwaway Postgres before
ever committing, but the live push itself has to happen from a machine that can actually reach
`api.supabase.com`, which this sandbox is blocked from).
