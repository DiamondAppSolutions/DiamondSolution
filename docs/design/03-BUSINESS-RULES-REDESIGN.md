# Business Rules — Revisited

Per your call to also improve shaky product rules, not just re-implement them: every rule
below follows **old behavior → the actual problem with it → new design → what's now
configurable**. Nothing here is final — these are recommendations to approve, tweak, or reject
before they're locked into the schema/Edge Functions. Items not listed here (the points
formula, the 60s/120s question timers, the 25% commission *concept*, two-currency support,
the two-language support, the general page layout) are kept as-is; they worked and aren't a
source of bugs.

## 1. Every signup becomes a paid, active affiliate partner automatically

**Old**: every new account silently got `isAffiliate: true, isPartner: true,
hasPaidAffiliateFee: true, affiliateStatus: 'active'` and a referral code, with no opt-in and
dead UI for a `'pending'` approval state that nothing ever set.

**Problem**: a field literally named `hasPaidAffiliateFee` being hardcoded `true` for everyone
is a sign a paid/approved tier was *designed* and then quietly abandoned mid-build — the kind
of drift that makes a codebase hard to trust. It also means every single profile carries bank
details, referral tracking, and commission eligibility whether or not the person ever intends
to refer anyone.

**New design**: affiliate status is **opt-in via one explicit action** ("Become an affiliate"
button on the dashboard/affiliate page) — still free, still instant, still no approval queue
(that part of the old design was fine), but it's a deliberate user action that creates the
`affiliate_profiles` row, not a side effect of signing up. No dead `'pending'` state exists in
the schema at all, because nothing produces it. If real manual approval is ever wanted later,
`app_settings.affiliate_requires_approval` (boolean, default `false`) is the single switch that
turns it on — but it isn't built until it's actually wanted.

## 2. The 2-device cap + 24-hour lockout + fee, keyed off a client-cleared localStorage ID

**Old**: tracks every device that's *ever* logged in (`registeredDeviceIds`, capped at 2,
identified by a value the client itself generates and can trivially clear); a 3rd distinct
device blocks the account for a hard, non-skippable 24 hours, then charges ₦1,000 to restore
access.

**Problem**: three compounding issues. (a) The device "identity" the whole mechanism depends on
is client-controlled and not actually durable — clearing site data resets it, so a determined
account-sharer evades the cap while an ordinary user who gets a new phone or clears their
browser gets blocked by accident. (b) It conflates "how many devices has this person ever
owned" with "is this account being shared right now" — those are different problems needing
different responses. (c) The response to a legitimate 3rd-device sign-in (new phone, replaced
laptop) is identical to the response to deliberate sharing: a full day of lockout plus a fee,
which reads as a monetization mechanic wearing a security costume.

**New design**: cap **concurrently active sessions**, not lifetime device count (see
`02-DATA-MODEL-AND-SECURITY.md` §7) — a real server-issued session the client can't fabricate
or clear away. Signing in beyond the cap (`app_settings.max_concurrent_sessions`, default 2)
simply revokes the oldest session with a "signed out on your other device" notice, same as
Netflix/Spotify. No lockout, no fee, for the common case of "I just have more devices than the
cap." If the product genuinely wants a deterrent for repeat abuse (e.g. the same account
tripping the cap 5+ times in a week), that's a **separate, explicitly-designed escalation
policy** — e.g. a cooldown that only engages after a configurable abuse threshold — not the
default response to an ordinary new-device sign-in. Recommend building the plain
revoke-oldest-session version first and only add an abuse-escalation tier if real data shows
it's needed.

## 3. One hardcoded super-admin email, exempt from every rule, in five different files

**Old**: `peteradekunle923@gmail.com` is special-cased in Login.tsx (×2), AuthContext.tsx,
`firestore.rules`, and the biometrics device-skip check — always admin, always exempt from the
device cap, even before any profile document exists.

**Problem**: a hardcoded identity bypass baked into multiple layers is a single point of
failure (if that inbox is ever compromised, every layer trusts it unconditionally) and doesn't
scale past one admin.

**New design**: `user_roles` is the only source of admin-ness, checked via one SQL function
(`is_admin()`). The first admin is granted through a one-time, documented bootstrap script run
once against a specific `user_id` after they sign up normally — an operational step, not
standing code. Multiple admins are a first-class case from day one, not an afterthought.

## 4. Admin security-clearance OTPs always email one hardcoded address

**Old**: every "Security Clearance" step-up OTP (suspend a user, approve a payout, delete a
user, etc.) emails `peteradekunle923@gmail.com` regardless of which admin is actually performing
the action.

**Problem**: breaks the moment there's more than one admin, and means the audit trail of "who
approved this" is weaker than it should be (anyone with access to that one inbox can approve
anyone's pending action).

**New design**: the OTP goes to the **acting admin's own verified email**, resolved from their
session. `admin_actions_log` records which admin performed which action, when, and why.

## 5. Permanent, non-expiring access once a department is paid for

**Old**: no expiry field exists anywhere; a department purchase grants access forever unless
the whole account is suspended/deleted.

**Problem** (flagged, not necessarily wrong): this may be the intended business model (the old
UI literally labels it "One-Time" fee) — but nothing in the schema *supports* changing that
without a three-places-have-to-agree migration, which is risky to do under pressure later.

**New design**: `access_grants.expires_at` and `department_pricing.access_duration_days` exist
from day one (nullable = lifetime, the current default). Turning on time-limited access for a
given department later is a data change (set a duration on that department's pricing row), not
a schema migration or a new code path — but the default behavior for every department, unless
explicitly configured otherwise, stays lifetime access, matching the old (and presumably still
intended) model.

## 6. Fixed, hardcoded 1 USD = ₦1,500 conversion rate

**Old**: used for reactivation fees, affiliate commission currency conversion, and the admin
analytics charts — a constant in source code, never updated.

**Problem**: real exchange rates move; a stale hardcoded rate either overcharges or undercharges
one side of every cross-currency transaction, more so the older the code gets without a
deploy.

**New design**: `app_settings.ngn_usd_fallback_rate` is still a stored fallback (so the system
never breaks if an FX API is unreachable), but the `verify-payment`/`request-payout` Edge
Functions first try a cached daily lookup from a free FX-rate API (refreshed once/day via a
scheduled job, cached in `app_settings` itself so there's no added runtime dependency on the
critical path). Every computed commission row snapshots the rate it actually used
(`commissions.commission_rate`, and we'd add `fx_rate_used` alongside it) — so a later rate
change never silently reinterprets historical records, unlike a global constant would.

## 7. Password-strength rules differ between signup (strong) and password-change (weak)

**Old**: registration requires 8+ chars with mixed character classes; Account Settings'
password-change form only requires 6+ chars, no class requirements.

**Problem**: plainly an inconsistency, not a deliberate choice — a user can "upgrade" to a
weaker password through one screen but not the other.

**New design**: one password policy, defined once (`app_settings.password_min_length` = 8 +
the same mixed-class check), enforced identically everywhere a password is set or changed —
Supabase Auth's own password strength option can also be enabled project-wide so this isn't
even app-code's responsibility to re-check.

## 8. Biometric "login" is really a recoverable password stored client-side

**Old**: the password is obfuscated with a hardcoded XOR key (shipped in the client bundle)
and stored in `localStorage`; "fingerprint unlock" just recovers and resubmits it.

**Problem**: not real security — anyone with localStorage access and the (public) key can
recover the plaintext password. Covered fully in §7 of the data-model doc: replaced with real
WebAuthn passkeys (a public key the server verifies a signed challenge against), which never
has a recoverable secret to steal in the first place.

## 9. Images stored as base64 strings inline on database documents

**Old**: every department/course picture is compressed client-side and stored as a base64 data
URI directly on the Firestore document, with no object storage used despite a bucket being
provisioned.

**Problem**: bloats document/row size, counts against the (already tight) free-tier database
storage quota instead of a separate, usually cheaper, storage quota, and makes the DB harder to
query/migrate (binary-ish blobs mixed into otherwise-small rows).

**New design**: Supabase Storage (an S3-compatible bucket) holds the actual image files;
`departments.image_path`/`courses.image_path` store just the storage object key. Public, signed
URLs serve the images; the database never carries anything bigger than a short text key. This
alone meaningfully extends how far the free tier's 500MB *database* allowance goes, since
images live in the separate 1GB *storage* allowance instead.

## 10. Raw OTP codes displayed in the admin System Logs screen

**Old**: the admin audit-log tab shows issued OTP codes in large plaintext — a real
"security log reveals the thing it's supposed to be protecting" problem.

**New design**: `security_otp_tokens.code_hash` is the only thing ever stored — the raw code is
emailed once and never persisted anywhere in plaintext, so there's nothing for an audit log to
leak even by mistake. `admin_actions_log` records the *action*, not the secret that authorized
it.

## 11. Two independently duplicated OTP/step-up-auth implementations

**Old**: the top-level admin dashboard and the Departments tab each maintain their own separate
copy of the "Security Clearance" modal/state/logic.

**New design**: one shared `request-otp`/`verify-otp` Edge Function pair and one shared
`security_otp_tokens` table, used by every admin screen and every student-facing step-up flow
identically. There is structurally nowhere for a second copy to drift into.

## Summary table — what's now a runtime setting instead of a hardcoded constant

| Old hardcoded value | New home |
|---|---|
| 2-device registration cap | `app_settings.max_registered_devices` *(superseded by concurrent-session cap, see #2)* |
| Concurrent session cap | `app_settings.max_concurrent_sessions` |
| 24h device-block lockout | *(removed by default — see #2; kept as a settable escalation tier if reintroduced)* |
| ₦1,000 / $2 reactivation fee | `app_settings.reactivation_fee_ngn` / `reactivation_fee_usd` |
| 25% affiliate commission rate | `app_settings.affiliate_commission_rate` (snapshotted per-commission row) |
| $10 / ₦10,000 min withdrawal | `app_settings.min_withdrawal_ngn` / `min_withdrawal_usd` |
| 1 USD = ₦1,500 fixed FX rate | `app_settings.ngn_usd_fallback_rate` (fallback only; live rate cached daily) |
| 6-char vs 8-char password rules | `app_settings.password_min_length` (one value, enforced everywhere) |
| "50 questions/day" onboarding copy | `app_settings.daily_question_goal` (so it's not just a hardcoded string in a tour slide) |
| Hardcoded super-admin email | *(removed — `user_roles` is the only source of admin-ness)* |
| Hardcoded OTP recipient email | *(removed — step-up OTPs go to the acting admin's own address)* |
