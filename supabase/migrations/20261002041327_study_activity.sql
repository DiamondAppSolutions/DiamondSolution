-- ============================================================================
-- Study activity: per-course resume state, the append-only attempt log, and
-- daily aggregate stats (the leaderboard's source table).
-- Design reference: 02-DATA-MODEL-AND-SECURITY.md §3.
-- ============================================================================

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
alter table study_progress enable row level security;

create type attempt_result as enum ('correct', 'incorrect', 'skipped', 'applied');

-- Append-only. Indexed for exactly the Activity Log's query shape (last N days for one user,
-- newest first) instead of the old app's "pull the whole history, filter in JS" pattern.
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
alter table question_attempts enable row level security;
create index question_attempts_user_time_idx on question_attempts (user_id, attempted_at desc);

create table daily_practice_stats (
  user_id uuid not null references auth.users(id) on delete cascade,
  practice_date date not null default current_date,
  attempted int not null default 0,
  correct int not null default 0,
  study_duration_seconds int not null default 0,
  primary key (user_id, practice_date)
);
alter table daily_practice_stats enable row level security;
-- Powers the leaderboard: aggregate by user across a date range, ordered by volume.
create index daily_practice_stats_date_idx on daily_practice_stats (practice_date, attempted desc);

-- ----------------------------------------------------------------------------
-- RLS — own rows only (or staff), standard pattern.
-- ----------------------------------------------------------------------------

create policy "study_progress_own_or_staff"
  on study_progress for select
  using (user_id = auth.uid() or is_moderator_or_admin());
create policy "study_progress_write_own"
  on study_progress for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "question_attempts_select_own_or_staff"
  on question_attempts for select
  using (user_id = auth.uid() or is_moderator_or_admin());
-- Insert-only for the owning user — an attempt, once logged, is never edited or deleted by
-- anyone but staff (it's an audit trail, not a draft).
create policy "question_attempts_insert_own"
  on question_attempts for insert
  with check (user_id = auth.uid());
create policy "question_attempts_staff_manage"
  on question_attempts for update using (is_moderator_or_admin());
create policy "question_attempts_staff_delete"
  on question_attempts for delete using (is_moderator_or_admin());

create policy "daily_practice_stats_select_own_or_staff"
  on daily_practice_stats for select
  using (user_id = auth.uid() or is_moderator_or_admin());
-- No direct client write policy at all for insert/update/delete — this table is only ever
-- written by record_question_attempt() below (security definer, so it bypasses this gap
-- deliberately), keeping attempted/correct counts from ever drifting out of sync with the
-- attempt log the way the old app's separate client-side increment occasionally could.

-- ----------------------------------------------------------------------------
-- The one-transaction write: an attempt, its daily-stats contribution, and the course's
-- resume state all move together or not at all. Called once per submitted question (manual
-- submit or timeout auto-submit) from StudyPage — never written to directly by the client.
-- ----------------------------------------------------------------------------

create or replace function record_question_attempt(
  p_course_id uuid,
  p_question_id uuid,
  p_selected_option_id uuid,
  p_result attempt_result,
  p_time_taken_seconds int,
  p_current_order int,
  p_completed boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_counts_as_correct boolean := p_result in ('correct', 'applied');
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  insert into question_attempts (
    user_id, course_id, question_id, selected_option_id, result, time_taken_seconds
  ) values (
    v_user_id, p_course_id, p_question_id, p_selected_option_id, p_result, p_time_taken_seconds
  );

  insert into daily_practice_stats (user_id, practice_date, attempted, correct, study_duration_seconds)
  values (v_user_id, current_date, 1, case when v_counts_as_correct then 1 else 0 end, coalesce(p_time_taken_seconds, 0))
  on conflict (user_id, practice_date) do update
    set attempted = daily_practice_stats.attempted + 1,
        correct = daily_practice_stats.correct + case when v_counts_as_correct then 1 else 0 end,
        study_duration_seconds = daily_practice_stats.study_duration_seconds + coalesce(p_time_taken_seconds, 0);

  insert into study_progress (user_id, course_id, current_order, completed, score_correct, score_total, updated_at)
  values (v_user_id, p_course_id, p_current_order, p_completed, case when v_counts_as_correct then 1 else 0 end, 1, now())
  on conflict (user_id, course_id) do update
    set current_order = p_current_order,
        completed = p_completed,
        score_correct = study_progress.score_correct + case when v_counts_as_correct then 1 else 0 end,
        score_total = study_progress.score_total + 1,
        updated_at = now();
end;
$$;

-- "Re-sync" (retake from scratch) — the only other way study_progress changes. Does not
-- touch question_attempts (the audit trail is permanent) or daily_practice_stats (today's
-- activity already happened and stays counted).
create or replace function reset_study_progress(p_course_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from study_progress where user_id = auth.uid() and course_id = p_course_id;
end;
$$;
