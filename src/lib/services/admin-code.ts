/**
 * How long an admin verification code is, and what counts as one.
 *
 * Its own module, with no `server-only`, because both sides need it: the
 * verification screen sizes its field from this, and the server decides what
 * it will accept from it. One number, so the two cannot drift into a form that
 * happily takes a code the server will always refuse.
 *
 * THE LENGTH IS SET IN SUPABASE, NOT HERE. GoTrue generates the code and
 * renders it into `{{ .Token }}`, and how long it makes it is the project's
 * `mailer_otp_length` — "Email OTP Length" under Authentication → Providers →
 * Email, or `GOTRUE_MAILER_OTP_LENGTH` when self-hosted. Supabase allows 6 to
 * 10 and newer projects default to 8.
 *
 * FayTarra's project mails EIGHT, so this is 8: the app agrees with the code
 * that actually arrives rather than insisting on a shorter one. The whole
 * eight digits are submitted and verified by Supabase. Nothing is trimmed to
 * fit — cutting a code down would throw away entropy and turn one wrong guess
 * into a hundredth of the search space, which is the opposite of what a second
 * factor is for.
 *
 * If the project's setting ever changes, change this number to match. They
 * must agree: a screen that accepts a length Supabase never sends is a screen
 * nobody can get through.
 */

/** Exactly this many digits. Never more, never fewer, never trimmed to fit. */
export const ADMIN_CODE_DIGITS = 8;

export type CodeCheck =
  | { ok: true; digits: string }
  | { ok: false; error: string; tooLong: boolean };

/**
 * Normalises what was typed and says whether it is the right shape.
 *
 * Spaces and dashes are stripped, because people paste codes with them in.
 * Everything else must be exactly `ADMIN_CODE_DIGITS` digits.
 */
export function checkCodeShape(input: string): CodeCheck {
  const digits = (input ?? '').replace(/\D/g, '');

  if (digits.length === ADMIN_CODE_DIGITS) return { ok: true, digits };

  return {
    ok: false,
    tooLong: digits.length > ADMIN_CODE_DIGITS,
    error:
      digits.length > ADMIN_CODE_DIGITS
        ? `FayTarra admin codes are ${ADMIN_CODE_DIGITS} digits. That one has ${digits.length}.`
        : `Enter the ${ADMIN_CODE_DIGITS} digits from the email.`,
  };
}
