-- affiliate_balances originally summed commission_amount/withdrawal amount across all
-- currencies into one figure per user — wrong the moment an affiliate earns in both NGN and
-- USD, since the two aren't the same unit. Split the view one row per (user_id, currency)
-- instead, so a NGN balance and a USD balance are never added together.

drop view if exists affiliate_balances;

create view affiliate_balances
with (security_invoker = true)
as
select
  ap.user_id,
  cur.currency,
  coalesce(c.total_earned, 0) as total_earned,
  coalesce(w.total_withdrawn, 0) as total_withdrawn,
  greatest(0, coalesce(c.total_earned, 0) - coalesce(w.total_withdrawn, 0)) as balance
from affiliate_profiles ap
cross join (values ('NGN'), ('USD')) as cur(currency)
left join (
  select referrer_user_id, commission_currency as currency, sum(commission_amount) as total_earned
  from commissions
  group by referrer_user_id, commission_currency
) c on c.referrer_user_id = ap.user_id and c.currency = cur.currency
left join (
  select user_id, currency, sum(amount) as total_withdrawn
  from withdrawals
  where status <> 'failed'
  group by user_id, currency
) w on w.user_id = ap.user_id and w.currency = cur.currency
-- Drop the all-zero NGN/USD filler row for a currency the affiliate has never earned in, so
-- the client only ever sees currencies that actually have activity.
where coalesce(c.total_earned, 0) > 0 or coalesce(w.total_withdrawn, 0) > 0;
