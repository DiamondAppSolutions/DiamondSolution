# Data Model & Security Design

All tables live in the `public` schema unless noted. `auth.users` is Supabase's own managed
table (email, hashed password, MFA factors) — we never duplicate credentials, only reference
`auth.users.id` as the user identity everywhere.

Conventions used throughout: `id uuid primary key default gen_random_uuid()` unless a natural
key is better; `created_at timestamptz not null default now()`; money stored as
`numeric(12,2)` (never float); every status column is a Postgres `enum` type, not a free
string, so a typo can't silently create a new unhandled state.

## 1. Identity & roles

```sql
create table profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  username text unique,
  institution_name text,
  university text,
  department_id uuid references departments(id),
  phone text,
  whatsapp text,
  language text not null default 'en' check (language in ('en','fr')),
  currency text not null default 'NGN' check (currency in ('NGN','USD')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create type app_role as enum ('student','moderator','admin');

create table user_roles (
  user_id uuid not null references auth.users(id) on delete cascade,
  role app_role not null,
  granted_by uuid references auth.users(id),
  granted_at timestamptz not null default now(),
  primary key (user_id, role)
);
```

**No hardcoded super-admin email anywhere** — not in this schema, not in any Edge Function, not
in any RLS policy. The first admin is created once via a documented bootstrap script
(`supabase/seed/00-bootstrap-admin.sql`, run manually against a specific user ID after that
person signs up normally) — this is the only "break glass" step, and it's a one-time
operational action, not a standing bypass baked into every layer of the app forever.

```sql
create or replace function is_admin() returns boolean
language sql security definer stable as $$
  select exists (select 1 from user_roles where user_id = auth.uid() and role = 'admin');
$$;

create or replace function is_moderator_or_admin() returns boolean
language sql security definer stable as $$
  select exists (select 1 from user_roles where user_id = auth.uid() and role in ('admin','moderator'));
$$;
```

**Column-level protection** (RLS is row-level, not column-level, so restricting *which fields*
a user may change needs a trigger):

```sql
create or replace function profiles_block_restricted_self_edit()
returns trigger language plpgsql as $$
begin
  if not is_admin() then
    if new.department_id is distinct from old.department_id and old.department_id is not null then
      -- allow setting it once at signup, block silent changes thereafter if desired;
      -- tune this rule deliberately rather than leaving it implicit.
      null;
    end if;
  end if;
  return new;
end; $$;
```
Role changes never go through `profiles` at all (role lives in `user_roles`, writable only via
the `admin-action` Edge Function using the `service_role` key — RLS on `user_roles` denies all
direct client writes). This alone removes an entire class of the old app's bugs, where `role`
sat as a plain string column on the same document a user could otherwise edit, and had to be
defended field-by-field inside one big `allow update` rule.

## 2. Catalog: departments, levels, courses, questions

```sql
create table departments (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  slug text not null unique,
  image_path text,            -- Supabase Storage object key, not base64
  status text not null default 'active' check (status in ('active','archived')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table department_pricing (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references departments(id) on delete cascade,
  currency text not null check (currency in ('NGN','USD')),
  amount numeric(12,2) not null check (amount >= 0),
  access_duration_days int,          -- null = lifetime access (configurable per department)
  effective_from timestamptz not null default now(),
  unique (department_id, currency, effective_from)
);
-- "current price" = the row with the latest effective_from <= now() per (department, currency).
-- This replaces two flat ₦/$ columns with real price history, so changing a price doesn't
-- silently reinterpret a payment made under the old price.

create table department_levels (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references departments(id) on delete cascade,
  label text not null,              -- '200L', 'MB 1', etc.
  sort_order int not null default 0,
  unique (department_id, label)
);

create type question_type as enum ('objective','application');

create table courses (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references departments(id),
  level_id uuid not null references department_levels(id),
  title text not null,
  slug text not null,
  description text,
  default_question_type question_type not null default 'objective',
  image_path text,
  status text not null default 'draft' check (status in ('draft','published','archived')),
  deleted_at timestamptz,            -- real soft-delete, not an isDeleted boolean mixed with other state
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (department_id, level_id, slug)
);

-- Replaces the old regex-parsed "Questions 1-20" free text with a real structured table —
-- eliminates an entire class of fragile text-parsing bugs.
create table course_outline_sections (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses(id) on delete cascade,
  title text not null,
  start_question_order int not null,
  end_question_order int not null,
  sort_order int not null default 0,
  check (end_question_order >= start_question_order)
);

create table questions (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses(id) on delete cascade,
  type question_type not null,
  prompt text not null,
  expected_answer text,              -- application type only
  explanation text,
  sort_order int not null,
  status text not null default 'active' check (status in ('active','trashed')),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Options as rows, not a fixed 5-slot array — supports 2-10 options without a migration,
-- and "is_correct" lives per-option instead of a separate correctAnswer index that can drift.
create table question_options (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references questions(id) on delete cascade,
  label text not null,               -- 'A', 'B', ...
  body text not null,
  is_correct boolean not null default false,
  sort_order int not null
);

-- Translations cached, not re-generated on every view like the old /api/translate call.
create table question_translations (
  question_id uuid not null references questions(id) on delete cascade,
  lang text not null check (lang in ('fr')),
  prompt text not null,
  explanation text,
  options jsonb,                      -- [{label, body}]
  generated_by text not null default 'gemini',
  created_at timestamptz not null default now(),
  primary key (question_id, lang)
);
```

**RLS**: `courses`/`questions`/`question_options` are readable by anyone signed in *for rows
belonging to a course the user has an active access grant for* (see §4), or by admins/moderators
always; writable only by admins/moderators. No "fetch content only if paid, to dodge a
permission error" client-side dance — the same query just returns zero rows if unauthorized,
which is both simpler code and leaks nothing (not even existence) to an unauthorized user.

## 3. Study activity

```sql
create table study_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  course_id uuid not null references courses(id) on delete cascade,
  current_order int not null default 0,
  completed boolean not null default false,
  score_correct int not null default 0,
  score_total int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, course_id)
);

create type attempt_result as enum ('correct','incorrect','skipped','applied');

-- Append-only, indexed for the exact query the old "Revision Center" needed (last N days for
-- one user) instead of pulling a user's entire history over the wire and filtering in JS.
create table question_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  course_id uuid not null references courses(id),
  question_id uuid not null references questions(id),
  selected_option_id uuid references question_options(id),
  result attempt_result not null,
  time_taken_seconds int,
  attempted_at timestamptz not null default now()
);
create index on question_attempts (user_id, attempted_at desc);

-- Written in the SAME transaction as question_attempts (one round trip, via a Postgres
-- function), so daily totals can never drift from the attempt log the way the old app's
-- separate dailyPractice increment occasionally could.
create table daily_practice_stats (
  user_id uuid not null references auth.users(id) on delete cascade,
  practice_date date not null,
  attempted int not null default 0,
  correct int not null default 0,
  study_duration_seconds int not null default 0,
  primary key (user_id, practice_date)
);
create index on daily_practice_stats (practice_date, attempted desc); -- powers the leaderboard
```

**RLS**: both tables — select/insert/update only where `user_id = auth.uid()`, or admin. The
leaderboard and "most active scholars" analytics read `daily_practice_stats` directly with a
normal indexed, paginated SQL query (`order by attempted desc limit 50`) — no "pull the top
1000 rows and approximate" workaround, because Postgres can aggregate the real table
efficiently with the index above instead of needing a bounded-read workaround the way a
Firestore collection scan did.

## 4. Payments & access grants

```sql
create type payment_status as enum ('pending','success','failed');
create type payment_purpose as enum ('department_access','suspension_reactivation','device_reactivation');

create table payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  provider text not null check (provider in ('paystack','flutterwave')),
  provider_reference text not null,
  purpose payment_purpose not null,
  department_id uuid references departments(id),
  amount numeric(12,2) not null check (amount > 0),
  currency text not null check (currency in ('NGN','USD')),
  status payment_status not null default 'pending',
  raw_provider_response jsonb,
  created_at timestamptz not null default now(),
  verified_at timestamptz,
  unique (provider, provider_reference)   -- a DB constraint, not an app-level "check if used" query
);

-- Decoupled from payments so one payment can (later) grant a bundle, and an admin-granted
-- comp/scholarship doesn't need a fake payment row to justify it.
create table access_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  department_id uuid not null references departments(id),
  granted_via_payment_id uuid references payments(id),
  granted_by uuid references auth.users(id),   -- set for admin-granted access
  starts_at timestamptz not null default now(),
  expires_at timestamptz,                       -- null = lifetime; see department_pricing.access_duration_days
  created_at timestamptz not null default now(),
  unique (user_id, department_id)
);
```

**RLS**: `payments` — select own rows or admin; **insert/update only via `service_role`** (the
Edge Function), exactly mirroring the old app's good "server is the only writer of success" rule,
now enforced by Postgres policy instead of a hand-reasoned Firestore rule. `access_grants`
— select own rows or admin; all writes via `service_role` only.

**Course access check** becomes one readable SQL condition instead of a three-tier
admin-bypass/legacy-doc-ID/deterministic-doc-ID fallback chain:
```sql
create or replace function has_department_access(dept uuid) returns boolean
language sql security definer stable as $$
  select is_admin() or exists (
    select 1 from access_grants
    where user_id = auth.uid() and department_id = dept
      and (expires_at is null or expires_at > now())
  );
$$;
```

## 5. Affiliate / referral program

```sql
create table affiliate_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  referral_code text not null unique,
  status text not null default 'inactive' check (status in ('inactive','active')),
  activated_at timestamptz
);

create table payout_methods (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  currency text not null check (currency in ('NGN','USD')),
  method text not null,            -- 'bank_transfer' | 'paypal' | 'usdt_trc20' | 'intl_wire'
  bank_code text,
  account_number text,
  account_name text,
  created_at timestamptz not null default now()
);

create table referrals (
  referred_user_id uuid primary key references auth.users(id) on delete cascade,
  referrer_user_id uuid not null references auth.users(id),
  referred_at timestamptz not null default now()
);

create table commissions (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references payments(id),
  referrer_user_id uuid not null references auth.users(id),
  referred_user_id uuid not null references auth.users(id),
  base_amount numeric(12,2) not null,
  base_currency text not null,
  commission_rate numeric(4,3) not null,    -- snapshot of app_settings at the time, not a live global
  commission_amount numeric(12,2) not null,
  commission_currency text not null,
  status text not null default 'pending' check (status in ('pending','paid')),
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  unique (payment_id)   -- one commission per qualifying payment, can't be double-minted
);

create type withdrawal_status as enum ('pending','success','failed');

create table withdrawals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  amount numeric(12,2) not null check (amount > 0),
  currency text not null check (currency in ('NGN','USD')),
  payout_method_id uuid references payout_methods(id),
  status withdrawal_status not null default 'pending',
  provider_reference text,
  provider_response jsonb,
  requested_at timestamptz not null default now(),
  processed_at timestamptz,
  processed_by uuid references auth.users(id)
);
```

**RLS**: `commissions` — select where `referrer_user_id = auth.uid()` or admin; insert/update
only `service_role`. `withdrawals` — select own or admin; **insert allowed for the owning user**
but a `check` constraint/trigger enforces `status = 'pending'` and `amount` within the
configured min/max at insert time (same "the user may only ever create a pending request"
invariant as before, just enforced by a `CHECK` instead of a Firestore validation function);
update/delete only admin/service_role. `affiliate_profiles`/`payout_methods` — full access to
own row only, no admin bypass needed since these aren't money-moving by themselves.

Balance is **never a stored column** — it's computed on read (`sum(commissions where
status<>'?') - sum(withdrawals where status<>'failed')`, floored at zero), exactly like the old
app's calculation, but as a SQL view (`affiliate_balances`) instead of client-side JS, so the
admin dashboard and the student's own affiliate page can never disagree about how it's
computed.

## 6. Notifications, chat, quotes, settings

```sql
create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,  -- null = broadcast
  title text not null,
  body text not null,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create table chat_threads (
  user_id uuid primary key references auth.users(id) on delete cascade,
  admin_unread_count int not null default 0,
  user_unread_count int not null default 0,
  last_message_at timestamptz
);

create table chat_messages (
  id uuid primary key default gen_random_uuid(),
  thread_user_id uuid not null references chat_threads(user_id) on delete cascade,
  sender text not null check (sender in ('user','admin')),
  body text not null,
  created_at timestamptz not null default now()
);
create index on chat_messages (thread_user_id, created_at desc); -- real keyset pagination, not "latest 50 forever"

create table quotes (
  id uuid primary key default gen_random_uuid(),
  text text not null,
  author text not null default 'Platform Team',
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table institutional_links (
  id int primary key default 1 check (id = 1),  -- singleton
  telegram text, whatsapp text, facebook text, twitter text, instagram text, support_email text,
  updated_at timestamptz not null default now()
);

-- Every previously hardcoded number lives here, admin-editable, versioned by updated_at.
create table app_settings (
  key text primary key,
  value jsonb not null,
  description text,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);
-- seed rows: max_registered_devices, max_concurrent_sessions, device_block_lockout_hours,
-- reactivation_fee_ngn, reactivation_fee_usd, affiliate_commission_rate, min_withdrawal_ngn,
-- min_withdrawal_usd, ngn_usd_fallback_rate, password_min_length, daily_question_goal, ...
```

## 7. Sessions, devices, and the OTP/step-up-auth system

This is the part of the old app most worth rebuilding from scratch rather than porting.

```sql
create table login_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  refresh_token_id text not null,      -- Supabase's own session/refresh-token identifier
  device_label text,                   -- derived server-side from user-agent, informational only
  ip inet,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index on login_sessions (user_id) where revoked_at is null;

create table login_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id),
  occurred_at timestamptz not null default now(),
  date_key date not null default current_date,
  hour_of_day int not null
);
-- Retention: a scheduled job prunes rows older than 400 days — decided up front, not
-- discovered as an unbounded-growth problem later.

create table security_otp_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  purpose text not null,               -- 'password_change' | 'device_reactivation' | 'admin_step_up'
  code_hash text not null,             -- hashed (bcrypt), never stored or logged in plaintext
  target_id text,                      -- e.g. the admin-action target row's id, for admin_step_up
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create table admin_actions_log (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null references auth.users(id),
  action text not null,                -- 'suspend_user' | 'change_role' | 'approve_payout' | ...
  target_table text,
  target_id text,
  reason text,
  created_at timestamptz not null default now()
);
```

**Implementation note**: Supabase Auth does have built-in session controls (time-boxed
sessions, inactivity timeout, "single session per user") — but they're **Pro-plan and up**,
and "single session per user" only supports a strict cap of exactly 1, never a configurable N.
Since we're targeting the free tier and want a configurable cap (default 2), this is
**custom-built** on top of `login_sessions`, not a setting we flip on. See `05-BACKEND.md` for
the exact `register-session` Edge Function and how an evicted session is actually invalidated.
If the project later moves to Supabase Pro and is fine with a strict single-session policy,
the built-in setting becomes a legitimate simplification to swap in at that point — noted here
so it isn't rediscovered as "wait, Supabase could have just done this."

**Why this replaces the old mechanism, point by point:**

- The old app's device "identity" was a value the *client* generated into `localStorage` and
  the server simply trusted (`diamond_device_id`). Clearing site data resets it, so the whole
  2-device cap is only as strong as "the user doesn't clear cookies," which isn't a real
  security boundary. Here, a **session is a server-issued row** created at sign-in — the client
  has no way to fabricate, inflate, or clear it away.
- **Concurrent-session cap, not "distinct devices ever seen."** The old design counted every
  device that had *ever* logged in, forever, capped at 2, with a punitive 24-hour lockout + fee
  for a 3rd. That conflates "how many devices do you own" with "account sharing," and punishes
  a legitimate user who gets a new phone. The new design instead caps **concurrently active**
  sessions (`max_concurrent_sessions` in `app_settings`, default e.g. 2): signing in beyond the
  cap simply **revokes the oldest session** (a "you've been signed out on your other device"
  notice, the same UX Netflix/Spotify use) — no 24-hour wait, no fee, no distinction between "a
  device I've used before" and "a new one." If the business genuinely wants a paid step for
  *repeat* abuse (not a first over-the-cap sign-in), that's a deliberate, separate policy to
  design on purpose — not a default. See `03-BUSINESS-RULES-REDESIGN.md` for the full
  before/after reasoning on this specific rule.
- **One shared OTP/step-up-auth implementation** (`request-otp`/`verify-otp` Edge Functions +
  `security_otp_tokens`), used identically for password-change, device-reactivation, and every
  admin destructive action — replacing the old app's two independently duplicated OTP
  modal/state implementations (the top-level admin one and the Departments tab's own copy).
- **Codes are hashed, never logged in plaintext.** The old app's System Logs tab displayed
  issued OTP codes directly to admins; this design never stores or surfaces the raw code
  anywhere after it's emailed — `admin_actions_log` records *that* a step-up action happened
  and *who* did it, never the secret that authorized it.
- **Step-up emails go to the acting admin's own address**, looked up from their own session —
  not a single hardcoded recipient, which breaks the moment there's more than one admin anyway.
- **Biometric/passkey login, done as actual WebAuthn**, not a password-recovery trick:
  Supabase Auth's own MFA (TOTP) covers "a second factor," and for a "fingerprint unlocks the
  app" convenience feature, the correct building block is a true **WebAuthn passkey**
  registered server-side (e.g. via `@simplewebauthn/server` inside an Edge Function) — the
  server stores a public key and a credential ID, never a password, obfuscated or otherwise.
  The old app's approach (XOR-obfuscating the real password with a key shipped in the client
  bundle, then storing it in `localStorage`) is not reproduced here under any configuration.

## 8. RLS is mandatory on every table — enforced, not remembered

**Postgres does not protect a table by default.** A table is only ever subject to its RLS
policies once `ALTER TABLE ... ENABLE ROW LEVEL SECURITY;` has run on it — before that, any
role holding a normal `GRANT` (which includes the `anon`/`authenticated` roles Supabase's
client SDK authenticates as) can read and write it directly through the auto-generated REST
API, policies or no policies. A forgotten `ENABLE ROW LEVEL SECURITY` line is a silently
**wide-open** table, not a silently locked one — the opposite of what the name suggests at a
glance.

**Convention, non-negotiable**: every migration that runs `CREATE TABLE` is immediately
followed, in the same file, by:
```sql
alter table <name> enable row level security;
```
With RLS enabled and zero policies yet written, the table is fully deny-all for
`anon`/`authenticated` — the same fail-closed posture as the old app's `firestore.rules`
global safety net (`match /{document=**} { allow read, write: if false; }`). Policies are then
added to deliberately reopen specific access; the default is always closed, never open.

**Enforced in CI, not left to memory** (the same category of mistake that let the old app's
deployed Firestore rules drift from its repo unnoticed): a migration/test step runs
```sql
select relname from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
```
against the local Supabase instance CI just built from the repo's own migrations, and fails
the build if it returns any row. This is a hard gate, run alongside the pgTAP suite below —
a table can never reach production without RLS enabled, full stop.

**One deliberate exception, not a gap**: the `service_role` key (used only inside Edge
Functions) always bypasses RLS regardless of policies — that's by design, the same bypass
concept as the old app's Admin SDK, and it's how the backend performs the privileged writes
RLS is meant to keep the client from doing directly.

## 9. RLS testing strategy — replacing the manual "Dirty Dozen" checklist

The old app had `security_spec.md`: a human-run checklist of adversarial payloads, re-run by
hand (if remembered) after a rules edit. Replace it with **pgTAP tests that run in CI on every
pull request**, one test per invariant, e.g.:

```sql
-- test: a non-admin cannot escalate their own role
select throws_ok(
  $$ update user_roles set role = 'admin' where user_id = $$ || quote_literal(test_user_id()),
  '42501', null, 'non-admin cannot self-promote'
);
```

Each of the old Dirty Dozen's twelve payloads becomes one such test, plus new ones specific to
this schema (e.g. "a user cannot insert a `commissions` row referencing their own payment,"
"a `payments` row cannot be inserted with `status='success'` by a non-service-role caller,"
"an expired `access_grants` row does not satisfy `has_department_access()`"). CI fails the
build if any of them fail — this is the structural fix for "the deployed rules drifted from the
repo and nobody noticed until a quota outage forced a look," since there is no separate
"deploy" step that can silently diverge: `supabase db push` applies the exact SQL in the repo,
and the test suite runs against that same SQL before it ever reaches production.
