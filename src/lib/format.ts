/** Compact number formatting shared across the UI. */
export function formatCount(value: number): string {
  if (value < 1000) return String(value);
  if (value < 10_000) return `${(value / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  if (value < 1_000_000) return `${Math.round(value / 1000)}k`;
  return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}m`;
}

/**
 * How many unread things a badge says.
 *
 * The real number up to ninety-nine, because "you have 12 unread messages" is
 * information and "9+" is not. Past that the exact figure stops being useful
 * and starts being a wide badge.
 */
export const UNREAD_CAP = 99;

export function formatUnread(value: number): string {
  return value > UNREAD_CAP ? `${UNREAD_CAP}+` : String(value);
}
