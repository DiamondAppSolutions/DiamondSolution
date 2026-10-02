-- ============================================================================
-- Affiliate/referral program. Design reference: 02-DATA-MODEL-AND-SECURITY.md §5,
-- 03-BUSINESS-RULES-REDESIGN.md §1 (opt-in, not auto-enrolled on signup).
-- ============================================================================

create table affiliate_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  referral_code text not null unique,
  status text not null default 'inactive' check (status in ('inactive', 'active')),
  activated_at timestamptz
);
alter table affiliate_profiles enable row level security;

create table payout_methods (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  currency text not null check (currency in ('NGN', 'USD')),
  method text not null check (method in ('bank_transfer', 'paypal', 'usdt_trc20', 'intl_wire')),
  bank_code text,
  account_number text,
  account_name text,
  created_at timestamptz not null default now()
);
alter table payout_methods enable row level security;

create table referrals (
  referred_user_id uuid primary key references auth.users(id) on delete cascade,
  referrer_user_id uuid not null references auth.users(id),
  referred_at timestamptz not null default now()
);
alter table referrals enable row level security;

create table commissions (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references payments(id),
  referrer_user_id uuid not null references auth.users(id),
  referred_user_id uuid not null references auth.users(id),
  base_amount numeric(12, 2) not null,
  base_currency text not null,
  commission_rate numeric(4, 3) not null,
  commission_amount numeric(12, 2) not null,
  commission_currency text not null,
  status text not null default 'pending' check (status in ('pending', 'paid')),
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  -- One commission per qualifying payment — can't be double-minted by retrying.
  unique (payment_id)
);
alter table commissions enable row level security;

create type withdrawal_status as enum ('pending', 'success', 'failed');

create table withdrawals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  amount numeric(12, 2) not null check (amount > 0),
  currency text not null check (currency in ('NGN', 'USD')),
  -- $10 / ₦10,000 minimum — see 03-BUSINESS-RULES-REDESIGN.md's summary table; will move to
  -- app_settings once that table exists, same as the password-policy constant elsewhere.
  check ((currency = 'USD' and amount >= 10) or (currency = 'NGN' and amount >= 10000)),
  payout_method_id uuid references payout_methods(id),
  status withdrawal_status not null default 'pending',
  provider_reference text,
  provider_response jsonb,
  requested_at timestamptz not null default now(),
  processed_at timestamptz,
  processed_by uuid references auth.users(id)
);
alter table withdrawals enable row level security;

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------

create policy "affiliate_profiles_select_own_or_staff"
  on affiliate_profiles for select
  using (user_id = auth.uid() or is_moderator_or_admin());
create policy "affiliate_profiles_write_own"
  on affiliate_profiles for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "payout_methods_manage_own"
  on payout_methods for all
  using (user_id = auth.uid() or is_moderator_or_admin())
  with check (user_id = auth.uid());

create policy "referrals_select_own_or_staff"
  on referrals for select
  using (referrer_user_id = auth.uid() or referred_user_id = auth.uid() or is_moderator_or_admin());
-- No client insert policy at all — a referral row is only ever created at signup time by the
-- handle_new_user trigger path (see below), never directly by the client, so a user can't
-- backdate or fabricate a referral relationship after the fact.

create policy "commissions_select_own_or_staff"
  on commissions for select
  using (referrer_user_id = auth.uid() or is_moderator_or_admin());
-- No client write policy — commissions are only ever computed and credited server-side
-- (service_role, inside processDepartmentAccessPayment) from a payment it independently
-- verified. This is the exact old-app vulnerability class this design closes: the old
-- Firestore rules once let the *referred* user's own client write an arbitrary
-- commissionAmount naming any referrerUid.

create policy "withdrawals_select_own_or_staff"
  on withdrawals for select
  using (user_id = auth.uid() or is_moderator_or_admin());
create policy "withdrawals_insert_own_pending"
  on withdrawals for insert
  with check (user_id = auth.uid() and status = 'pending');
create policy "withdrawals_staff_manage"
  on withdrawals for update using (is_moderator_or_admin());
create policy "withdrawals_staff_delete"
  on withdrawals for delete using (is_moderator_or_admin());

-- ----------------------------------------------------------------------------
-- Referral capture at signup: extends handle_new_user (from the init migration) so a
-- referral_code passed through signUp()'s metadata creates a referrals row atomically with
-- the account itself — no separate client write, no race with email confirmation.
-- ----------------------------------------------------------------------------

create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_referrer_id uuid;
begin
  insert into public.profiles (
    user_id, display_name, username, institution_name, university,
    department_id, phone, whatsapp, language
  )
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data ->> 'username', split_part(new.email, '@', 1)),
    new.raw_user_meta_data ->> 'institution_name',
    new.raw_user_meta_data ->> 'university',
    nullif(new.raw_user_meta_data ->> 'department_id', '')::uuid,
    new.raw_user_meta_data ->> 'phone',
    new.raw_user_meta_data ->> 'whatsapp',
    coalesce(new.raw_user_meta_data ->> 'language', 'en')
  )
  on conflict (user_id) do nothing;

  if new.raw_user_meta_data ->> 'referral_code' is not null then
    select user_id into v_referrer_id
    from affiliate_profiles
    where referral_code = new.raw_user_meta_data ->> 'referral_code';

    if v_referrer_id is not null and v_referrer_id <> new.id then
      insert into referrals (referred_user_id, referrer_user_id)
      values (new.id, v_referrer_id)
      on conflict (referred_user_id) do nothing;
    end if;
  end if;

  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- Balance = total earned minus total withdrawn (excluding failed withdrawals), floored at
-- zero. security_invoker so a regular user querying this view only ever sees what the
-- underlying tables' RLS already lets them see (their own rows); staff see everyone's,
-- because the underlying policies already grant staff that.
-- ----------------------------------------------------------------------------

create view affiliate_balances
with (security_invoker = true)
as
select
  ap.user_id,
  coalesce(c.total_earned, 0) as total_earned,
  coalesce(w.total_withdrawn, 0) as total_withdrawn,
  greatest(0, coalesce(c.total_earned, 0) - coalesce(w.total_withdrawn, 0)) as balance
from affiliate_profiles ap
left join (
  select referrer_user_id, sum(commission_amount) as total_earned
  from commissions
  group by referrer_user_id
) c on c.referrer_user_id = ap.user_id
left join (
  select user_id, sum(amount) as total_withdrawn
  from withdrawals
  where status <> 'failed'
  group by user_id
) w on w.user_id = ap.user_id;
