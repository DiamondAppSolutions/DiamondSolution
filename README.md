# Diamond Solution

A study/exam-prep platform: departments/courses, timed practice, a leaderboard, an
affiliate/referral program, and an admin back office. This is a ground-up rebuild of an
earlier Firebase-based version of the same product — see
[`docs/design/00-INDEX.md`](./docs/design/00-INDEX.md) for the full design package (why
Supabase, the complete data model, the business rules that were deliberately revisited, the
backend/Edge Function design, and the phased build roadmap this repo is following).

- **Frontend**: React 19 + Vite + TypeScript + Tailwind v4, routed with `react-router-dom`.
- **Backend**: Supabase — Postgres (with Row-Level Security as the authorization layer),
  Auth, Storage, Realtime, and Edge Functions for anything money-moving or
  identity-sensitive. See [`docs/design/01-ARCHITECTURE.md`](./docs/design/01-ARCHITECTURE.md).
- **Payments**: Paystack, server-verified before any access is granted — the client never
  self-reports a successful payment.

## Getting started

```bash
npm install
cp .env.example .env.local   # fill in your Supabase project's URL/anon key (see below)
npm run dev                   # Vite dev server
npm run lint                  # tsc --noEmit
npm run build                 # typecheck + vite build
```

### Local Supabase (schema, RLS, Edge Functions)

Requires Docker.

```bash
npx supabase start            # local Postgres + Auth + Storage + Realtime
npx supabase db reset         # applies every migration in supabase/migrations/ fresh
npx supabase status           # prints local API URL + anon key for .env.local
```

### Connecting to your actual Supabase project

```bash
npx supabase link --project-ref <your-project-ref>
npx supabase db push          # applies migrations to the linked project
```

`VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` (frontend) come from your Supabase project's
API settings page. Edge Function secrets (`PAYSTACK_SECRET_KEY`, etc.) are set with
`supabase secrets set KEY=value` — never committed to this repo.

## Project structure

```
src/
  pages/            Route-level screens
  components/        Shared UI (ProtectedRoute, ...)
  context/            AuthContext (session, profile, roles)
  lib/                supabase.ts client, passwordPolicy.ts, ...
supabase/
  migrations/         Schema + RLS, applied in order — the only way the live DB ever changes
  functions/           Edge Functions (payment verification, OTP, admin actions, ...)
  tests/pgtap/          RLS invariant tests, run in CI
  seed/                 One-time bootstrap scripts (e.g. granting the first admin)
docs/design/            The full design package — read this before changing architecture
```

## Status

Following the phased plan in
[`docs/design/04-ROADMAP.md`](./docs/design/04-ROADMAP.md). Currently: **Phase 1** —
identity/roles/catalog schema and RLS are in place and validated; Auth pages (Login/Register)
are wired to real Supabase Auth with the full profile created server-side via a trigger on
`auth.users` (race-free regardless of email-confirmation settings). Payment verification,
the study flow, and everything after are not built yet.
