-- ============================================================================
-- Phase 4 (04-ROADMAP.md) admin-hardening, scoped down: this is the audit-trail half of
-- 02-DATA-MODEL-AND-SECURITY.md §7's admin_actions_log, without the OTP step-up half
-- (request-otp/verify-otp/security_otp_tokens). That half needs a real email-delivery
-- provider decision (Resend, SendGrid, Supabase's own rate-limited default, ...) that hasn't
-- been made yet — building it against no configured provider would ship code nobody could
-- actually test or use, so it's deferred rather than guessed at. This table is useful on its
-- own regardless of that decision: every withdrawal-affecting admin action (the most
-- money-sensitive thing already built) now leaves a durable, who/what/when record.
-- ============================================================================

create table admin_actions_log (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null references auth.users(id),
  action text not null,
  target_table text,
  target_id text,
  reason text,
  created_at timestamptz not null default now()
);
alter table admin_actions_log enable row level security;

create index admin_actions_log_created_idx on admin_actions_log (created_at desc);

create policy "admin_actions_log_select_staff"
  on admin_actions_log for select
  using (is_moderator_or_admin());

-- No client insert/update/delete policy at all — every row is written server-side, from the
-- specific action that actually happened (request-payout Edge Function,
-- mark_withdrawal_paid_manually()), never by a client claiming an action occurred.

create or replace function log_admin_action(
  p_action text,
  p_target_table text,
  p_target_id text,
  p_reason text default null
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into admin_actions_log (actor_user_id, action, target_table, target_id, reason)
  values (auth.uid(), p_action, p_target_table, p_target_id, p_reason);
$$;

-- mark_withdrawal_paid_manually now also writes its own admin_actions_log row, so every
-- withdrawal settlement path — automated Paystack payout and manual "paid outside Paystack"
-- alike — is auditable the same way.
create or replace function mark_withdrawal_paid_manually(
  p_withdrawal_id uuid,
  p_reference text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_amount numeric;
  v_currency text;
  v_status text;
begin
  if not is_moderator_or_admin() then
    raise exception 'Admin or moderator access required.';
  end if;

  select user_id, amount, currency, status
    into v_user_id, v_amount, v_currency, v_status
    from withdrawals
    where id = p_withdrawal_id
    for update;

  if v_user_id is null then
    raise exception 'Withdrawal not found.';
  end if;
  if v_status <> 'pending' then
    raise exception 'Withdrawal is already %.', v_status;
  end if;

  update withdrawals
  set status = 'success',
      provider_reference = p_reference,
      provider_response = jsonb_build_object('manual', true),
      processed_at = now(),
      processed_by = auth.uid()
  where id = p_withdrawal_id;

  insert into notifications (user_id, type, title, body)
  values (
    v_user_id,
    'withdrawal_processed',
    'Withdrawal paid',
    format('Your withdrawal of %s %s was paid out.', v_amount, v_currency)
  );

  insert into admin_actions_log (actor_user_id, action, target_table, target_id, reason)
  values (auth.uid(), 'withdrawal_paid_manually', 'withdrawals', p_withdrawal_id::text, p_reference);
end;
$$;
