/**
 * Display names only an official administrator may wear.
 *
 * The badge is, and stays, the real signal — it comes from the `role` column
 * and nothing a person types can produce one. This is the smaller companion
 * problem: somebody calling themselves "FayTarra Admin" in a comment thread
 * is misleading at a glance even with no badge beside them, because most
 * people read the name and not the pixels next to it.
 *
 * So the NAME is reserved too. Not as a security boundary — it is not one —
 * but so the obvious impersonation costs something.
 *
 * MATCHING IS EXACT, after normalising. That is deliberate: the aim is to stop
 * somebody being "FayTarra Admin", not to police every name containing the
 * word admin. "FayTarra Administrator", "Admin", "Fay's Admin" and "Tarra
 * Admin Services" are all still fine, because none of them normalise to the
 * reserved string. Blocking anything broader would break real names to prevent
 * a confusion nobody actually has.
 */

/**
 * The names nobody but an admin may use, already normalised.
 *
 * Exactly one, deliberately. Widening this is a one-line change — adding
 * 'faytarrasupport', 'faytarrastaff' or 'faytarraadministrator' would work
 * the same way — but each entry can catch a real person's name, so the set
 * stays at what was actually asked for rather than what might be nice.
 */
const RESERVED = new Set(['faytarraadmin']);

/**
 * Characters that are not what they look like.
 *
 * Cyrillic а and Latin a are different code points that render identically, so
 * "FаyTаrrа Admin" with Cyrillic vowels passes a naive comparison while
 * looking exactly like the real thing. Same story for Greek omicron, and for
 * the digits people substitute for letters.
 *
 * Folding these is safe here ONLY because the comparison is exact: a genuine
 * Cyrillic name would have to fold to precisely "faytarraadmin" to be caught,
 * which means it was never a genuine name.
 */
const CONFUSABLES: Record<string, string> = {
  // Cyrillic
  а: 'a', в: 'b', е: 'e', к: 'k', м: 'm', н: 'h', о: 'o', р: 'p', с: 'c',
  т: 't', у: 'y', х: 'x', і: 'i', ѕ: 's', ԁ: 'd', ғ: 'f', м̆: 'm',
  // Greek
  α: 'a', ο: 'o', ρ: 'p', τ: 't', υ: 'y', ν: 'v', ι: 'i', κ: 'k', μ: 'm',
  // Digits standing in for letters
  '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't',
};

/**
 * Reduces a display name to what it actually reads as.
 *
 * NFKC first, which folds fullwidth "ＦａｙＴａｒｒａ", ligatures and a
 * lot of decorative maths alphabets onto plain letters. Then invisible
 * characters go — a zero-width space between two letters is invisible to a
 * reader and would otherwise defeat any comparison. Then confusables. Then
 * everything that is not a letter or digit, which collapses spacing, dashes,
 * underscores, dots and brackets at once: "Fay-Tarra_Admin", "「FayTarra
 * Admin」" and "F a y T a r r a  A d m i n" all land on the same string.
 */
export function normaliseDisplayName(raw: string): string {
  return (raw ?? '')
    .normalize('NFKC')
    .toLowerCase()
    // Zero-width and other format characters, plus the joiners.
    .replace(/[­​-‏⁠﻿᠎]/g, '')
    .split('')
    .map((char) => CONFUSABLES[char] ?? char)
    .join('')
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Is this name one only an administrator may use?
 *
 * Returns false for an empty name — "you must enter something" is a different
 * message, and this should not be the thing that says it.
 */
export function isReservedDisplayName(raw: string): boolean {
  const normalised = normaliseDisplayName(raw);
  return normalised.length > 0 && RESERVED.has(normalised);
}

/** What to tell somebody who tried. */
export const RESERVED_NAME_ERROR =
  'That display name is reserved for official FayTarra accounts. Choose another.';
