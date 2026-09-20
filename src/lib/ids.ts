import { randomUUID } from 'node:crypto';

/** UUIDs everywhere so rows move between the local driver and Supabase as-is. */
export function newId(): string {
  return randomUUID();
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 48);
}
