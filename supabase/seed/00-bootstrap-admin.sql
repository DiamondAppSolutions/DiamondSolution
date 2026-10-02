-- ============================================================================
-- One-time admin bootstrap. Not run automatically by `supabase db push` or
-- CI — this is a deliberate manual step, run once, documented here rather
-- than baked into application code as a standing bypass (see
-- 03-BUSINESS-RULES-REDESIGN.md §3: no hardcoded super-admin email exists
-- anywhere in this codebase; this script is the entire mechanism instead).
--
-- HOW TO USE:
--   1. Sign up for an account normally through the app's own Register page.
--   2. Find that account's user_id — Supabase dashboard → Authentication →
--      Users → click the account → copy its "User UID".
--   3. Replace YOUR-USER-ID-HERE below with that UID.
--   4. Run this file's contents in the Supabase SQL Editor (dashboard →
--      SQL Editor → New query → paste → Run), or via:
--        psql "<connection string from Supabase dashboard>" -f supabase/seed/00-bootstrap-admin.sql
--   5. Sign out and back in on that account — role is read fresh on each
--      sign-in by AuthContext, so a stale session won't show the new role
--      until then.
--
-- To promote further admins later, do it through the app itself once one
-- admin exists (the admin-manage-user Edge Function's 'change_role' action,
-- once built) rather than repeating this script — this file is only for
-- getting the very first admin in place.
-- ============================================================================

insert into user_roles (user_id, role)
values ('YOUR-USER-ID-HERE', 'admin')
on conflict (user_id, role) do nothing;
