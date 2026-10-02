# Build Roadmap

A phased plan so the first working version is small and real, not a big-bang rewrite attempt.
Each phase ends with something runnable.

## Phase 0 — Decide & set up (no code)

- [ ] Approve or amend `01-ARCHITECTURE.md` and `03-BUSINESS-RULES-REDESIGN.md` — especially
      the device/session policy change (§2) and the affiliate opt-in change (§1), since those
      are the two most user-visible departures from the old app.
- [ ] Pick a name/brand (separate from "Diamond Solution" — a new identity, even if the domain
      stays similar).
- [ ] Create the Supabase project (free tier) and the GitHub repo.
- [ ] Set up the repo skeleton: Vite + React + TypeScript + Tailwind frontend,
      `supabase/migrations/` for schema, `supabase/functions/` for Edge Functions.
- [ ] Set up CI (GitHub Actions): typecheck, lint, pgTAP RLS tests, `supabase db push --dry-run`
      against a throwaway branch/preview DB on every PR.

## Phase 1 — Identity, catalog, and the paywall (the vertical slice)

Goal: a student can sign up, log in, browse departments, pay for one with Paystack, and see
content unlock. This is the smallest end-to-end slice that proves the core architecture
(RLS + Edge Function payment verification) actually works, before building anything else on
top of it.

- [ ] `profiles`, `user_roles`, `departments`, `department_pricing`, `department_levels`,
      `courses`, `questions`, `question_options` tables + RLS policies + pgTAP tests.
- [ ] Supabase Auth wired up (email+password, email verification).
- [ ] Admin bootstrap script; a minimal admin screen to create departments/courses/questions
      (even a plain form is fine for this phase — the full tabbed back office comes later).
- [ ] `verify-payment` + `paystack-webhook` Edge Functions; `access_grants`/`payments` tables.
- [ ] Student-facing: Splash/Login/Register, department browse + paywall, course detail.
- [ ] **Milestone check**: a real test payment (Paystack test mode) ends with a row in
      `access_grants` and visibly unlocks a course — verified manually and by an integration
      test, not just "looks right in the UI."

## Phase 2 — Study flow & activity

- [ ] `study_progress`, `question_attempts`, `daily_practice_stats` tables + RLS + the
      one-transaction write function that keeps attempt log and daily stats consistent.
- [ ] StudyPage: timers, resume, the outline-sections-based "section complete" flow (now a real
      table lookup, not regex parsing).
- [ ] Activity Log ("Revision Center") — a real indexed, paginated query from day one.
- [ ] Leaderboard — real SQL aggregation off `daily_practice_stats`, no "top 1000 rows,
      approximate" workaround needed.
- [ ] Dashboard — stats strip, 7-day chart, department carousel, quotes.

## Phase 3 — Affiliate program & payouts

- [ ] `affiliate_profiles`, `payout_methods`, `referrals`, `commissions`, `withdrawals` + RLS.
- [ ] "Become an affiliate" opt-in action (§1 of the business-rules doc) + referral capture at
      signup.
- [ ] `request-payout` Edge Function (Paystack Transfer API), admin payout-approval screen.
- [ ] Affiliate dashboard (balance view, commission/withdrawal history, payout credentials).

## Phase 4 — Notifications, chat, admin back office

- [x] `notifications` (in-app only — bell icon + unread badge, auto-created on payment
      success/failure, commission earned, and withdrawal outcomes). No Realtime subscription
      used for this; a fetch-on-open dropdown was enough for a bounded, per-user list.
- [ ] `chat_threads`, `chat_messages` (+ Realtime subscription for live chat and unread
      badges — the one place Realtime would actually be used). Deferred on purpose — the old
      app's bottom nav had a "Chats" tab the new one doesn't yet, and this is that gap.
- [ ] WhatsApp admin-notify Edge Function (best-effort, same pattern as before). Deferred
      together with chat — in the old app this function only exists to relay a chat message to
      the admin's WhatsApp, so it has nothing to do until chat itself is built.
- [x] The tabbed admin back office — built as several focused screens instead of one
      ~5,000-line file (Departments, Courses, Questions, Transactions, Withdrawals, Audit Log),
      each a separate component with its own one-time-fetch-on-mount data loading. No
      Realtime/live-subscription tab exists yet since nothing built so far needs one.
- [x] `admin_actions_log` (the audit-trail half) — every withdrawal-affecting admin action
      (approve/reject/pay-via-Paystack/mark-paid-manually) writes a row; viewable at
      `/admin/audit-log`.
- [ ] Admin security-clearance (step-up OTP) flow — one shared implementation, used
      everywhere. **Blocked on a decision, not forgotten**: `request-otp` needs a real
      email-delivery path (Resend, SendGrid, Supabase's own default SMTP, or a provider
      already in use elsewhere) that hasn't been chosen yet. Building it against no
      configured provider would ship code nobody could actually test or receive an email
      from, so this stays undone until that choice is made — see
      `06-SUPABASE-DEPLOYMENT-CHECKLIST.md` for where this fits in the go-live sequence once
      decided.

## Phase 5 — Device/session policy, MFA, hardening

- [ ] `login_sessions`, `login_events`, the sign-in Auth hook enforcing
      `max_concurrent_sessions` (§2 of the business-rules doc).
- [ ] Optional TOTP MFA via Supabase Auth; WebAuthn passkey registration as the "quick unlock"
      replacement, if wanted.
- [ ] Full pgTAP RLS test suite covering every invariant (the Dirty-Dozen successor), gating
      CI.
- [ ] Error tracking (Sentry free tier) + a basic uptime check on the Edge Functions.
- [ ] Load-shape review against the free-tier limits with realistic 1,000-user numbers before
      calling it launch-ready (see checklist below).

## Phase 6 — i18n, translation caching, polish

- [ ] English/French string tables (same two-language scope as before).
- [ ] `question_translations` caching for the admin "translate to French" feature (Gemini),
      so it's a one-time generation per question, not a per-view API call.
- [ ] Visual/brand pass — this is also the point to decide the new platform's own voice,
      separate from the old "institutional/security-protocol" tone, if a change is wanted.

## Pre-launch checklist

- [ ] The CI gate from `02-DATA-MODEL-AND-SECURITY.md` §8 (every `public` table has RLS
      enabled, checked by query against `pg_class`/`pg_namespace`, not by memory) is green —
      and has been green since Phase 1, not bolted on right before launch.
- [ ] Every money-moving table's insert/update is `service_role`-only where the design calls
      for it — re-verify against `02-DATA-MODEL-AND-SECURITY.md` table by table.
- [ ] pgTAP suite green in CI; manually re-run the old `security_spec.md`-style payloads once
      by hand as a sanity check even though CI now covers them automatically.
- [ ] Paystack is switched from test to live keys, with one real low-value transaction done
      post-deploy to confirm the webhook + verify path both work end-to-end in production.
- [ ] Free-tier headroom check: current DB size vs. 500MB, Storage usage vs. 1GB, Edge Function
      call volume vs. 500k/month, bandwidth vs. ~5GB/month — know the numbers before 1,000 real
      users arrive, not after.
- [ ] A documented upgrade path (Supabase's paid tier pricing) is written down *before* it's
      needed, so hitting a limit is a planned decision, not a 2am outage.
