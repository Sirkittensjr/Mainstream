/**
 * The gate in front of Supabase's authentication emails.
 *
 * Deliberately not in rate-limit.ts: everything there counts rows in the
 * database and is server-only, while this is pure in-memory arithmetic that
 * has to work before anybody is signed in — and being pure is what makes it
 * testable on its own.
 */
/**
 * How often one address may be sent an authentication email from here.
 *
 * This is a courtesy gate in front of Supabase, not the real limit. It is a
 * per-instance sliding window — a serverless deployment runs several, so a
 * determined caller can get past it — and it exists so an impatient person
 * jabbing "send again" is told to wait instead of being bounced by GoTrue,
 * and so an obvious script costs something. The limit that actually protects
 * the sending domain is Supabase's own rate limiting (Authentication → Rate
 * Limits), which is enforced server-side no matter who asks.
 */
function configuredCooldown(): number {
  const raw = Number(process.env.AUTH_EMAIL_COOLDOWN_SECONDS);
  // Clamped rather than trusted: this only ever shortens the courtesy gate in
  // front of Supabase, never Supabase's own rate limiting, but a typo should
  // not be able to turn it into an hour either.
  return Number.isFinite(raw) && raw >= 0 ? Math.min(raw, 3600) : 30;
}

export const EMAIL_COOLDOWN_SECONDS = configuredCooldown();
const EMAILS_PER_HOUR = 6;

const emailWindows = new Map<string, number[]>();

export type EmailLimitResult = { ok: true } | { ok: false; retryAfter: number; error: string };

/**
 * Records a send against `email` and says whether it was allowed.
 *
 * Keyed on the address rather than an account, because the whole point is to
 * work before anybody is signed in — and because an address that has no
 * account must be treated exactly like one that does, or this becomes a way
 * to find out which is which.
 */
export function checkEmailSendLimit(email: string, now: number = Date.now()): EmailLimitResult {
  const key = email.trim().toLowerCase();
  const hourAgo = now - 3_600_000;
  const recent = (emailWindows.get(key) ?? []).filter((at) => at > hourAgo);

  const last = recent[recent.length - 1];
  if (last !== undefined && now - last < EMAIL_COOLDOWN_SECONDS * 1000) {
    const retryAfter = Math.ceil((EMAIL_COOLDOWN_SECONDS * 1000 - (now - last)) / 1000);
    return {
      ok: false,
      retryAfter,
      error: `Please wait ${retryAfter} second${retryAfter === 1 ? '' : 's'} before asking for another email.`,
    };
  }

  if (recent.length >= EMAILS_PER_HOUR) {
    const retryAfter = Math.ceil((recent[0] + 3_600_000 - now) / 1000);
    return {
      ok: false,
      retryAfter,
      error: 'That is a lot of emails to one address. Try again in a little while.',
    };
  }

  recent.push(now);
  emailWindows.set(key, recent);
  if (emailWindows.size > 5000) {
    for (const [id, times] of emailWindows) {
      if (times.every((at) => at <= hourAgo)) emailWindows.delete(id);
    }
  }
  return { ok: true };
}

/** Test seam: forget every recorded send. */
export function resetEmailSendLimits(): void {
  emailWindows.clear();
}
