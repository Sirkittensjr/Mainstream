/**
 * Who is an official FayTarra administrator, and what the badge says.
 *
 * One derivation, from the `role` column the database owns. Nothing else
 * grants it: not a display name, not a bio, not a profile colour, not
 * anything a person can type into a form. `role` is not among the columns the
 * API roles may UPDATE (see the grant block in supabase/schema.sql), so a
 * signed-in person cannot write themselves one through PostgREST either.
 *
 * The badge is decided on the SERVER and handed to the browser as a plain
 * boolean. The raw role never travels: a client component that was given
 * `role` could be handed `'admin'` by anything, and a value the client could
 * set is not a fact about the account.
 */

/** What the badge says, everywhere it appears. One string, no variants. */
export const ADMIN_BADGE_LABEL = 'FayTarra Admin';

/**
 * Is this account an official administrator?
 *
 * Takes the role rather than a whole user so it can be called from anywhere
 * that has one, and returns false for anything it does not recognise —
 * undefined, null, a missing column on an un-migrated database, or a role
 * somebody invented. Only the exact string counts.
 */
export function isAdminRole(role: string | null | undefined): boolean {
  return role === 'admin';
}
