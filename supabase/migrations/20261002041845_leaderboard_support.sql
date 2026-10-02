-- ============================================================================
-- Two narrow, scoped functions, both security definer for a specific documented
-- reason rather than as a general bypass:
--
-- 1. leaderboard(): real server-side GROUP BY aggregation over daily_practice_stats,
--    ordered by the actual points formula. A plain (non-security-definer) function
--    would be useless here — RLS on daily_practice_stats only lets a caller see
--    their own rows, so a leaderboard needs to deliberately cross that boundary to
--    aggregate everyone's numbers. This is the "no top-1000-rows approximation"
--    fix from 04-ROADMAP.md: Postgres aggregates the real table with the existing
--    (practice_date, attempted desc) index, returning only summed totals per user,
--    never raw per-day rows.
--
-- 2. public_profile_names(): the equivalent of the old app's /api/public-profiles —
--    exposes only display_name/university for a given set of user ids, never
--    email/balance/bank details, so the leaderboard (and later, any other
--    cross-user display) doesn't need profiles' RLS loosened for everyone.
-- ============================================================================

create or replace function leaderboard(
  p_from date,
  p_to date,
  p_department_id uuid default null,
  p_limit int default 50
)
returns table (user_id uuid, attempted bigint, correct bigint)
language sql
security definer
set search_path = public
stable
as $$
  select dps.user_id, sum(dps.attempted) as attempted, sum(dps.correct) as correct
  from daily_practice_stats dps
  join profiles p on p.user_id = dps.user_id
  where dps.practice_date between p_from and p_to
    and (p_department_id is null or p.department_id = p_department_id)
  group by dps.user_id
  order by (sum(dps.attempted) * 2 + sum(dps.correct) * 0.5) desc
  limit p_limit;
$$;

create or replace function public_profile_names(p_user_ids uuid[])
returns table (user_id uuid, display_name text, university text)
language sql
security definer
set search_path = public
stable
as $$
  select profiles.user_id, profiles.display_name, profiles.university
  from profiles
  where profiles.user_id = any(p_user_ids);
$$;
