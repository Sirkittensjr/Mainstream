/**
 * What to tell somebody when something they did failed.
 *
 * FayTarra's own errors are written to be read — "That clip is 3.2s and only
 * 1.1s of room is left" — and are shown as they are. What must never reach the
 * screen is the browser's or the runtime's own wording: a dropped connection
 * arrives as a TypeError saying "Load failed" (Safari) or "Failed to fetch"
 * (Chrome), and a programming slip as "Cannot read properties of undefined".
 * Those become a plain sentence with something to do about it.
 */

/** A connection that dropped or never formed, in any browser's wording. */
const NETWORK = /failed to fetch|^load failed\.?$|networkerror|network request failed|network error|the internet connection appears to be offline/i;

/** Wording that belongs to a stack trace, not to a person. */
const TECHNICAL =
  /undefined|null|is not a function|cannot read|cannot set|unexpected token|json|failed to execute|\bat \w|^\w*error\b|\(\d{3}\)/i;

export const CONNECTION_LOST =
  'Your connection dropped. Check it and try again — nothing you made has been lost.';

export function userFacingError(failure: unknown, fallback: string): string {
  if (!(failure instanceof Error)) return fallback;
  const message = failure.message.trim();
  if (failure instanceof TypeError || NETWORK.test(message)) return CONNECTION_LOST;
  if (!message || TECHNICAL.test(message)) return fallback;
  return message;
}
