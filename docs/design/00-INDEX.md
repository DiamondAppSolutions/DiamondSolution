# New Platform — Design Package (read in this order)

Same functional surface as the old Diamond Solution app (MCQ exam-prep, courses/departments,
timed practice, leaderboard, affiliate program, admin back office) — rebuilt from scratch with
the engineering decisions this app learned the hard way already baked in, and the shakiest
product rules deliberately reconsidered. No repo exists yet on purpose — this is the plan to
approve before one is created.

1. **`01-ARCHITECTURE.md`** — the stack decision (Supabase: Postgres + Auth + Storage +
   Realtime + Edge Functions) and why, the system diagram, what deploys where, what stays the
   same from the old app on purpose vs. what changes.
2. **`02-DATA-MODEL-AND-SECURITY.md`** — the full relational schema (every table, every
   column, every constraint), the Row-Level-Security policy strategy, and the session/device/
   OTP redesign. This is the core engineering document.
3. **`03-BUSINESS-RULES-REDESIGN.md`** — every shaky rule from the old app
   (auto-enrolled-affiliate, the device-block-plus-fee mechanic, hardcoded admin/OTP emails,
   the fixed FX rate, inconsistent password rules, the fake biometric security, plaintext OTPs
   in logs) with old behavior → the actual problem → the new design. **Read this one closely —
   it's where real product decisions need your sign-off**, especially #1 (affiliate opt-in)
   and #2 (replacing the 24h device-block-plus-fee with a plain session cap).
4. **`04-ROADMAP.md`** — a 6-phase build plan ending in a concrete pre-launch checklist tied to
   the free-tier numbers.
5. **`05-BACKEND.md`** — the Edge Function layer in full: project layout, the auth pattern,
   the exact endpoint list, rate limiting, and the corrected session-eviction mechanism (an
   earlier draft of this package assumed Supabase's built-in session controls would cover the
   device-session cap; checked against Supabase's current docs, those are Pro-plan-only and
   only support a strict 1-session cap, so §3 of this file designs it ourselves instead).
6. **`06-SUPABASE-DEPLOYMENT-CHECKLIST.md`** — the repo now exists and Phases 1–4 (notifications)
   are built, but nothing has reached a live Supabase project yet since this has all been built
   from a sandbox that can't reach `api.supabase.com`. This is the exact, ordered list of what
   to run from a real machine: link + push the schema, set secrets, deploy Edge Functions,
   register the Paystack webhook, connect Cloudflare Pages, configure Auth redirect URLs, set
   Cloudflare env vars, bootstrap the first admin, and smoke-test a real payment before going
   live.

## Open decisions for you specifically

- §2 in the business-rules doc removes the 24-hour lockout + ₦1,000 fee for a 3rd device,
  replacing it with "oldest session gets signed out, no fee." If the fee was actually valued as
  revenue (not just as a security mechanic), say so — it can be kept as a deliberate,
  separately-justified monetization feature instead of being framed as security.
- §1 makes "become an affiliate" an explicit button instead of automatic for every signup. If
  the business specifically wants every user to be a visible affiliate by default (e.g. for
  marketing/virality reasons independent of security), that's a legitimate reason to keep
  auto-enrollment — just worth deciding on purpose rather than carrying it forward by inertia.
- A platform name/brand — this package deliberately avoids inventing one.

## Next step

Once you've reviewed and adjusted these four files, say so and I'll either keep iterating on
the plan or move to creating the actual repo and starting Phase 1.
