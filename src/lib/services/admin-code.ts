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
 * "Email OTP Length" (Authentication → Providers → Email; the
 * `GOTRUE_MAILER_OTP_LENGTH` variable when self-hosted). Supabase allows 6 to
 * 10, so a project set to 8 mails eight digits and nothing in this repository
 * can change that — only agree with it or refuse it.
 *
 * Refusing is the right answer when they disagree. Cutting an eight-digit code
 * down to six would throw away two digits of entropy and quietly turn one
 * wrong guess into a hundredth of the search space, which is the opposite of
 * what a second factor is for.
 */

/** Exactly this many digits. Never more, never fewer, never trimmed to fit. */
export const ADMIN_CODE_DIGITS = 6;

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
