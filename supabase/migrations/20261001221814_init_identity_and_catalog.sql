-- ============================================================================
-- Identity, roles, catalog, and the access-grant/payment foundation.
-- Design reference: 02-DATA-MODEL-AND-SECURITY.md sections 1, 2, 4, 8.
--
-- Convention enforced throughout this file and every migration after it:
-- every `create table` is immediately followed by `enable row level security`
-- before any policy exists, so a table is never reachable by anon/authenticated
-- until a policy deliberately reopens it. service_role bypasses RLS entirely
-- (used only by Edge Functions) and is not a gap in this posture.
-- ============================================================================

create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- Shared helper: keep updated_at current on every UPDATE.
-- ----------------------------------------------------------------------------
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- 1. Identity & roles
-- ----------------------------------------------------------------------------

create type app_role as enum ('student', 'moderator', 'admin');

create table departments (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  slug text not null unique,
  image_path text,
  status text not null default 'active' check (status in ('active', 'archived')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table departments enable row level security;

create trigger departments_set_updated_at
  before update on departments
  for each row execute function set_updated_at();

create table profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  username text unique,
  -- Free-text institution/university name — one field, matching how a student actually
  -- identifies their school ("University of Ibadan"), not split into two.
  university text,
  department_id uuid references departments(id),
  phone text,
  whatsapp text,
  language text not null default 'en' check (language in ('en', 'fr')),
  currency text not null default 'NGN' check (currency in ('NGN', 'USD')),
  -- Not in the original design sketch (02-DATA-MODEL-AND-SECURITY.md §1) but required by
  -- the admin-manage-user suspend/unsuspend action from 05-BACKEND.md's endpoint table —
  -- added here rather than left implicit.
  status text not null default 'active' check (status in ('active', 'suspended')),
  suspension_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table profiles enable row level security;

create trigger profiles_set_updated_at
  before update on profiles
  for each row execute function set_updated_at();

create table user_roles (
  user_id uuid not null references auth.users(id) on delete cascade,
  role app_role not null,
  granted_by uuid references auth.users(id),
  granted_at timestamptz not null default now(),
  primary key (user_id, role)
);
alter table user_roles enable row level security;

create or replace function is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from user_roles where user_id = auth.uid() and role = 'admin'
  );
$$;

create or replace function is_moderator_or_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from user_roles where user_id = auth.uid() and role in ('admin', 'moderator')
  );
$$;

create or replace function is_suspended()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    (select status = 'suspended' from profiles where user_id = auth.uid()),
    false
  );
$$;

-- profiles policies
create policy "profiles_select_own_or_staff"
  on profiles for select
  using (user_id = auth.uid() or is_moderator_or_admin());

create policy "profiles_insert_own"
  on profiles for insert
  with check (user_id = auth.uid());

create policy "profiles_update_own_or_admin"
  on profiles for update
  using (user_id = auth.uid() or is_admin())
  with check (
    -- A non-admin may update their own row freely EXCEPT status/suspension_reason,
    -- which only admin-manage-user (service_role) may change.
    is_admin()
    or (
      user_id = auth.uid()
      and status = (select status from profiles p where p.user_id = auth.uid())
      and suspension_reason is not distinct from (select suspension_reason from profiles p where p.user_id = auth.uid())
    )
  );

-- user_roles policies: no direct client writes at all, by anyone, ever.
-- Role changes only ever happen via the admin-manage-user Edge Function with service_role.
create policy "user_roles_select_own_or_admin"
  on user_roles for select
  using (user_id = auth.uid() or is_admin());

-- Supabase's email-confirmation flow means a freshly-signed-up client often has no active
-- session yet (no auth.uid()) at the moment of signup, so the client cannot reliably INSERT
-- its own `profiles` row right after calling signUp(). The standard, race-free fix is a
-- trigger on auth.users that creates the profile the moment the account exists, server-side,
-- regardless of confirmation state. The Register page passes every collected field through
-- signUp()'s `options.data` (stored as raw_user_meta_data) so the full profile is created in
-- one step here, rather than needing a second "complete your profile" step after confirmation.
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (
    user_id, display_name, username, university,
    department_id, phone, whatsapp, language
  )
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data ->> 'username', split_part(new.email, '@', 1)),
    new.raw_user_meta_data ->> 'university',
    nullif(new.raw_user_meta_data ->> 'department_id', '')::uuid,
    new.raw_user_meta_data ->> 'phone',
    new.raw_user_meta_data ->> 'whatsapp',
    coalesce(new.raw_user_meta_data ->> 'language', 'en')
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ----------------------------------------------------------------------------
-- 2. Catalog: departments, levels, courses, questions
-- ----------------------------------------------------------------------------

create table department_pricing (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references departments(id) on delete cascade,
  currency text not null check (currency in ('NGN', 'USD')),
  amount numeric(12, 2) not null check (amount >= 0),
  access_duration_days int, -- null = lifetime access
  effective_from timestamptz not null default now(),
  unique (department_id, currency, effective_from)
);
alter table department_pricing enable row level security;

create table department_levels (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references departments(id) on delete cascade,
  label text not null,
  sort_order int not null default 0,
  unique (department_id, label)
);
alter table department_levels enable row level security;

create type question_type as enum ('objective', 'application');

create table courses (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references departments(id),
  level_id uuid not null references department_levels(id),
  title text not null,
  slug text not null,
  description text,
  default_question_type question_type not null default 'objective',
  image_path text,
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  deleted_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (department_id, level_id, slug)
);
alter table courses enable row level security;

create trigger courses_set_updated_at
  before update on courses
  for each row execute function set_updated_at();

create table course_outline_sections (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses(id) on delete cascade,
  title text not null,
  start_question_order int not null,
  end_question_order int not null,
  sort_order int not null default 0,
  check (end_question_order >= start_question_order)
);
alter table course_outline_sections enable row level security;

create table questions (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses(id) on delete cascade,
  type question_type not null,
  prompt text not null,
  expected_answer text,
  explanation text,
  sort_order int not null,
  status text not null default 'active' check (status in ('active', 'trashed')),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table questions enable row level security;

create trigger questions_set_updated_at
  before update on questions
  for each row execute function set_updated_at();

create table question_options (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references questions(id) on delete cascade,
  label text not null,
  body text not null,
  is_correct boolean not null default false,
  sort_order int not null
);
alter table question_options enable row level security;

create table question_translations (
  question_id uuid not null references questions(id) on delete cascade,
  lang text not null check (lang in ('fr')),
  prompt text not null,
  explanation text,
  options jsonb,
  generated_by text not null default 'gemini',
  created_at timestamptz not null default now(),
  primary key (question_id, lang)
);
alter table question_translations enable row level security;

-- ----------------------------------------------------------------------------
-- 4. Payments & access grants (brought forward from the "payments" section of
-- the design doc because has_department_access(), used by the catalog's own
-- RLS below, needs access_grants to exist — keeping the two in the same
-- migration avoids a window where course/question RLS would be half-correct.)
-- ----------------------------------------------------------------------------

create type payment_status as enum ('pending', 'success', 'failed');
create type payment_purpose as enum ('department_access', 'suspension_reactivation');

create table payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  provider text not null check (provider in ('paystack', 'flutterwave')),
  provider_reference text not null,
  purpose payment_purpose not null,
  department_id uuid references departments(id),
  amount numeric(12, 2) not null check (amount > 0),
  currency text not null check (currency in ('NGN', 'USD')),
  status payment_status not null default 'pending',
  raw_provider_response jsonb,
  created_at timestamptz not null default now(),
  verified_at timestamptz,
  unique (provider, provider_reference)
);
alter table payments enable row level security;

create table access_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  department_id uuid not null references departments(id),
  granted_via_payment_id uuid references payments(id),
  granted_by uuid references auth.users(id),
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, department_id)
);
alter table access_grants enable row level security;

create or replace function has_department_access(dept uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select is_admin() or exists (
    select 1 from access_grants
    where user_id = auth.uid()
      and department_id = dept
      and (expires_at is null or expires_at > now())
  );
$$;

-- departments / department_pricing / department_levels: public read (browsing the
-- catalog before signup is fine — the same posture as the old app's public `faculties`
-- read rule), admin-only write.
create policy "departments_select_public"
  on departments for select
  using (true);

create policy "departments_write_admin"
  on departments for all
  using (is_admin())
  with check (is_admin());

create policy "department_pricing_select_public"
  on department_pricing for select
  using (true);

create policy "department_pricing_write_admin"
  on department_pricing for all
  using (is_admin())
  with check (is_admin());

create policy "department_levels_select_public"
  on department_levels for select
  using (true);

create policy "department_levels_write_admin"
  on department_levels for all
  using (is_admin())
  with check (is_admin());

-- courses: signed-in, non-suspended users can see published courses; admins/moderators
-- see everything (including drafts/trashed, for the admin back office).
create policy "courses_select_signed_in"
  on courses for select
  using (
    is_moderator_or_admin()
    or (auth.uid() is not null and not is_suspended() and status = 'published' and deleted_at is null)
  );

create policy "courses_write_staff"
  on courses for all
  using (is_moderator_or_admin())
  with check (is_moderator_or_admin());

create policy "course_outline_sections_select_signed_in"
  on course_outline_sections for select
  using (
    is_moderator_or_admin()
    or (auth.uid() is not null and not is_suspended())
  );

create policy "course_outline_sections_write_staff"
  on course_outline_sections for all
  using (is_moderator_or_admin())
  with check (is_moderator_or_admin());

-- questions / question_options / question_translations: gated by real department
-- access, not by a three-way fallback chain like the old app — one readable condition.
create policy "questions_select_with_access"
  on questions for select
  using (
    is_moderator_or_admin()
    or (
      not is_suspended()
      and status = 'active'
      and deleted_at is null
      and has_department_access((select department_id from courses where courses.id = questions.course_id))
    )
  );

create policy "questions_write_staff"
  on questions for all
  using (is_moderator_or_admin())
  with check (is_moderator_or_admin());

create policy "question_options_select_with_access"
  on question_options for select
  using (
    is_moderator_or_admin()
    or (
      not is_suspended()
      and exists (
        select 1 from questions q
        join courses c on c.id = q.course_id
        where q.id = question_options.question_id
          and q.status = 'active'
          and q.deleted_at is null
          and has_department_access(c.department_id)
      )
    )
  );

create policy "question_options_write_staff"
  on question_options for all
  using (is_moderator_or_admin())
  with check (is_moderator_or_admin());

create policy "question_translations_select_with_access"
  on question_translations for select
  using (
    is_moderator_or_admin()
    or (
      not is_suspended()
      and exists (
        select 1 from questions q
        join courses c on c.id = q.course_id
        where q.id = question_translations.question_id
          and q.status = 'active'
          and q.deleted_at is null
          and has_department_access(c.department_id)
      )
    )
  );

create policy "question_translations_write_staff"
  on question_translations for all
  using (is_moderator_or_admin())
  with check (is_moderator_or_admin());

-- payments: select own or staff; all writes are service_role only (Edge Functions),
-- mirroring the old app's one correct rule — the client never self-reports success.
create policy "payments_select_own_or_staff"
  on payments for select
  using (user_id = auth.uid() or is_moderator_or_admin());

-- Deliberately no insert/update/delete policy for payments: with RLS enabled and no
-- write policy, only service_role (which bypasses RLS) can write. This *is* the
-- enforcement — there is nothing further to add.

-- access_grants: select own or staff; writes are service_role only, same reasoning.
create policy "access_grants_select_own_or_staff"
  on access_grants for select
  using (user_id = auth.uid() or is_moderator_or_admin());
