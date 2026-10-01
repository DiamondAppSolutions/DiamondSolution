// One password policy, used everywhere a password is set or changed (signup, and later the
// password-change flow) — see 03-BUSINESS-RULES-REDESIGN.md §7. The old app enforced this only
// at signup and a weaker 6-char rule at password-change; that inconsistency is not reproduced.
// Will move to app_settings.password_min_length once that table exists (later phase).
export const PASSWORD_MIN_LENGTH = 8;

export function validatePassword(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  if (!/[A-Z]/.test(password))
    return "Password must contain an uppercase letter.";
  if (!/[a-z]/.test(password))
    return "Password must contain a lowercase letter.";
  if (!/[0-9]/.test(password)) return "Password must contain a digit.";
  if (!/[^A-Za-z0-9]/.test(password))
    return "Password must contain a special character.";
  return null;
}
