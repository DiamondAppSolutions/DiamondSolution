-- ============================================================================
-- Phase 4 (04-ROADMAP.md): notifications. Scoped here to in-app notifications only —
-- chat_threads/chat_messages and the WhatsApp admin-notify function are deferred together,
-- since that WhatsApp integration only exists to relay chat messages (see the old app's
-- /api/whatsapp/notify-admin), so it has nothing to do until chat itself is built.
-- ============================================================================

create type notification_type as enum (
  'payment_success',
  'payment_failed',
  'commission_earned',
  'withdrawal_processed'
);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type notification_type not null,
  title text not null,
  body text not null,
  read boolean not null default false,
  created_at timestamptz not null default now()
);
alter table notifications enable row level security;

create index notifications_user_created_idx
  on notifications (user_id, created_at desc);

create policy "notifications_select_own"
  on notifications for select
  using (user_id = auth.uid());

-- No client insert/update policy at all — every notification is created server-side
-- (service_role, from the specific Edge Function/trigger that knows the real event
-- happened), the same pattern already used for commissions. Marking one read goes through
-- mark_notification_read() below rather than a loose client UPDATE policy, so a user can
-- flip the one field they're meant to without a column-privilege workaround to stop them
-- rewriting title/body/type on their own rows.

create or replace function mark_notification_read(p_notification_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update notifications
  set read = true
  where id = p_notification_id and user_id = auth.uid();
$$;

create or replace function mark_all_notifications_read()
returns void
language sql
security definer
set search_path = public
as $$
  update notifications
  set read = true
  where user_id = auth.uid() and read = false;
$$;

-- Staff-only: settles a withdrawal paid outside Paystack (PayPal/USDT/wire) and notifies the
-- affiliate in one atomic step. Mirrors what the request-payout Edge Function's success path
-- does for a NGN bank-transfer payout, so every settlement path — automated or manual —
-- leaves the same trail: an updated withdrawals row and a notification, never just one.
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
end;
$$;
