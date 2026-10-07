import { randomUUID } from 'node:crypto';

/** UUIDs everywhere so rows move between the local driver and Supabase as-is. */
export function newId(): string {
  return randomUUID();
}
