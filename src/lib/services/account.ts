import 'server-only';
import { db, isMissingColumn, storageIsDurable } from '@/lib/db';
import { refreshCommunity } from './community-cache';
import { DAY } from '@/lib/time';
import { AUTH_NOT_CONFIGURED, authConfigured } from '@/lib/supabase/config';
import { createAdminAuthClient, createAuthClient } from '@/lib/supabase/server';
import { CATEGORIES, type Category, type User } from '@/lib/types';
import { checkEmailSendLimit, EMAIL_COOLDOWN_SECONDS } from './email-limit';
import { getUserByUsername } from './users';

export const USERNAME_RULES = 'letters, numbers and underscores, 3–20 characters';
const USERNAME_RE = /^[a-z0-9_]{3,20}$/;
const RESERVED = new Set([
  'admin', 'faytarra', 'fay', 'home', 'discover', 'create', 'profile', 'login',
  'signup', 'settings', 'search', 'notifications', 'rankings', 'api', 'rules',
  'post', 'u', 'me', 'rate', 'support', 'help', 'auth', 'verify-email',
  'forgot-password', 'reset-password',
]);

/**
 * Which control a validation message belongs to, so a form can show it beside
 * the thing that is wrong instead of in one banner at the bottom.
 */
export type SignUpField =
  | 'email'
  | 'username'
  | 'password'
  | 'display_name'
  | 'interests';

export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; field?: SignUpField };

export interface SignUpInput {
  email: string;
  username: string;
  password: string;
  display_name: string;
  bio?: string;
  location?: string;
  avatar_url?: string | null;
  interests: Category[];
}

export interface SignUpOutcome {
  /** True when Supabase requires the address to be confirmed before signing in. */
  needsEmailConfirmation: boolean;
  userId: string;
}

/** Username rules, checked before we ask Supabase to create anything. */
export function validateUsername(raw: string): Result<string> {
  const username = raw.trim().toLowerCase();
  if (!USERNAME_RE.test(username)) {
    return { ok: false, error: `Usernames use ${USERNAME_RULES}.`, field: 'username' };
  }
  if (RESERVED.has(username)) {
    return { ok: false, error: 'That username is reserved.', field: 'username' };
  }
  return { ok: true, value: username };
}

export async function isUsernameAvailable(username: string): Promise<boolean> {
  return (await getUserByUsername(username)) === null;
}

/**
 * How long somebody must wait between @username changes.
 *
 * Long enough that a handle cannot be cycled to dodge a block or confuse
 * people who just learned it, short enough that a typo is not permanent.
 */
export const USERNAME_COOLDOWN_DAYS = 14;

export type ChangeUsernameResult =
  | { ok: true; username: string }
  | { ok: false; error: string };

/**
 * Changes the @username on an EXISTING account.
 *
 * Nothing else moves. The row's id is the Supabase Auth user id and is never
 * touched, so posts, comments, followers, following, ratings, notifications
 * and messages all stay attached — they reference the id, not the handle.
 */
export async function changeUsername(
  userId: string,
  desired: string,
  now: number = Date.now(),
): Promise<ChangeUsernameResult> {
  const store = db();
  const user = await store.get('users', userId);
  if (!user) return { ok: false, error: 'Sign in again to change your username.' };

  const validated = validateUsername(desired);
  if (!validated.ok) return { ok: false, error: validated.error };
  const username = validated.value;

  if (username === user.username) {
    return { ok: false, error: 'That is already your username.' };
  }

  if (user.username_changed_at) {
    const readyAt = new Date(user.username_changed_at).getTime() + USERNAME_COOLDOWN_DAYS * DAY;
    if (now < readyAt) {
      const days = Math.max(1, Math.ceil((readyAt - now) / DAY));
      return {
        ok: false,
        error: `You can change your username again in ${days} day${days === 1 ? '' : 's'}.`,
      };
    }
  }

  // Friendly check first; the case-insensitive unique index is what actually
  // guarantees it, and is what catches two people racing for the same handle.
  const taken = await getUserByUsername(username);
  if (taken && taken.id !== userId) {
    return { ok: false, error: 'That username is taken.' };
  }

  try {
    await store.update('users', userId, {
      username,
      username_changed_at: new Date(now).toISOString(),
    });
    refreshCommunity();
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : '';
    if (message.includes('unique') || message.includes('duplicate')) {
      return { ok: false, error: 'That username is taken.' };
    }
    // Without the column there is no cooldown, and the cooldown is what stops
    // a handle being cycled to dodge a block. Changing the username anyway
    // would drop that quietly, so say what is actually wrong instead.
    if (isMissingColumn(error, 'users', 'username_changed_at')) {
      return {
        ok: false,
        error:
          'Username changes are not available on this deployment yet. ' +
          'The database is missing migration 0003.',
      };
    }
    throw error;
  }

  return { ok: true, username };
}

/**
 * Creates the account.
 *
 * Supabase Auth owns the credentials — this code never sees a password hash.
 * The profile row is created by the `on_auth_user_created` trigger inside the
 * same transaction as the auth user, so a duplicate username fails the signup
 * outright instead of leaving an account with no profile.
 */
export async function signUp(input: SignUpInput): Promise<Result<SignUpOutcome>> {
  if (!authConfigured()) return { ok: false, error: AUTH_NOT_CONFIGURED };

  // Auth can be configured while the database is not. Creating the account
  // anyway would hand somebody a real login whose profile is written to
  // storage that does not survive the next request.
  if (!storageIsDurable()) {
    return {
      ok: false,
      error:
        'Accounts are switched off on this deployment: it has no database configured, so a ' +
        'profile created now would not be saved. Set SUPABASE_SERVICE_ROLE_KEY and redeploy.',
    };
  }

  const email = input.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { ok: false, error: 'Enter a valid email.', field: 'email' };
  }

  const username = validateUsername(input.username);
  if (!username.ok) return username;

  if (input.password.length < 8) {
    return { ok: false, error: 'Password must be at least 8 characters.', field: 'password' };
  }
  if (!input.display_name.trim()) {
    return { ok: false, error: 'Add a display name.', field: 'display_name' };
  }
  if (input.interests.length === 0) {
    return { ok: false, error: 'Pick at least one thing you are into.', field: 'interests' };
  }

  // Friendly check first; the unique index is what actually guarantees it.
  if (!(await isUsernameAvailable(username.value))) {
    return { ok: false, error: 'That username is taken.', field: 'username' };
  }

  const supabase = await createAuthClient();
  if (!supabase) return { ok: false, error: AUTH_NOT_CONFIGURED };

  const { data, error } = await supabase.auth.signUp({
    email,
    password: input.password,
    options: {
      emailRedirectTo: `${siteUrl()}/auth/callback?next=/home`,
      data: {
        username: username.value,
        display_name: input.display_name.trim().slice(0, 40),
        bio: (input.bio ?? '').trim().slice(0, 240),
        location: (input.location ?? '').trim().slice(0, 60),
        avatar_url: input.avatar_url ?? '',
        interests: input.interests.slice(0, 6),
      },
    },
  });

  if (error) {
    const message = error.message.toLowerCase();
    if (message.includes('username_taken') || message.includes('unique')) {
      return { ok: false, error: 'That username is taken.', field: 'username' };
    }
    if (message.includes('already registered') || message.includes('already been registered')) {
      return {
        ok: false,
        error: 'That email already has an account. Try signing in.',
        field: 'email',
      };
    }
    return { ok: false, error: error.message };
  }
  if (!data.user) return { ok: false, error: 'Could not create the account. Try again.' };

  // The profile comes from the database trigger. If it is missing, the project
  // has not been migrated, so create it here rather than leaving a broken
  // account behind.
  await ensureProfile(data.user.id, email, {
    username: username.value,
    display_name: input.display_name.trim().slice(0, 40),
    bio: (input.bio ?? '').trim().slice(0, 240),
    location: (input.location ?? '').trim().slice(0, 60) || null,
    avatar_url: input.avatar_url ?? null,
    interests: input.interests.slice(0, 6),
  });

  return {
    ok: true,
    value: { needsEmailConfirmation: data.session === null, userId: data.user.id },
  };
}

interface ProfileSeed {
  username: string;
  display_name: string;
  bio: string;
  location: string | null;
  avatar_url: string | null;
  interests: Category[];
}

/** Emails listed in ADMIN_EMAILS get the admin role on their first sign-in. */
function isAdminEmail(email: string): boolean {
  return (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
    .includes(email.trim().toLowerCase());
}

/**
 * Makes sure the auth user has a FayTarra profile.
 *
 * Normally the `on_auth_user_created` trigger has already done this inside the
 * signup transaction, in which case this only applies ADMIN_EMAILS — the
 * trigger runs in Postgres and cannot see the app's environment.
 */
export async function ensureProfile(
  id: string,
  email: string,
  seed: ProfileSeed,
): Promise<User | null> {
  const store = db();
  const existing = await store.get('users', id);
  if (existing) {
    if (existing.role !== 'admin' && isAdminEmail(email)) {
      return store.update('users', id, { role: 'admin' });
    }
    return existing;
  }

  const now = new Date().toISOString();
  const row = {
    id,
    email,
    username: seed.username,
    display_name: seed.display_name,
    bio: seed.bio,
    avatar_url: seed.avatar_url,
    location: seed.location,
    interests: seed.interests,
    role: isAdminEmail(email) ? ('admin' as const) : ('user' as const),
    status: 'active' as const,
    status_reason: null,
    trusted: true,
    username_changed_at: null,
    created_at: now,
    last_active_at: now,
  };

  try {
    const created = await store.insert('users', row);
    // A new account changes who is in the rankings and the suggestions.
    refreshCommunity();
    return created;
  } catch (error) {
    // A database that predates migration 0003 has no `username_changed_at`.
    // Refusing to create the profile over a column that only the username
    // cooldown needs would lock people out of an account Supabase Auth has
    // already made, so write the row without it and let the migration add it.
    if (isMissingColumn(error, 'users', 'username_changed_at')) {
      const { username_changed_at: _omitted, ...withoutColumn } = row;
      try {
        return await store.insert('users', withoutColumn as typeof row);
      } catch {
        return store.get('users', id);
      }
    }
    // Lost a race with the trigger, which is fine — it got there first.
    return store.get('users', id);
  }
}

/**
 * Profile for an authenticated Supabase user, creating it from the metadata
 * captured at signup if it is somehow missing (an account made in the Supabase
 * dashboard, or a database that never got the trigger).
 */
export async function profileForAuthUser(user: {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
}): Promise<User | null> {
  const meta = user.user_metadata ?? {};
  const rawInterests = Array.isArray(meta.interests) ? meta.interests : [];
  const interests = rawInterests.filter((value): value is Category =>
    (CATEGORIES as readonly string[]).includes(String(value)),
  );
  const username = String(meta.username ?? '').toLowerCase() || `user_${user.id.slice(0, 8)}`;

  return ensureProfile(user.id, user.email ?? '', {
    username,
    display_name: String(meta.display_name ?? username),
    bio: String(meta.bio ?? ''),
    location: String(meta.location ?? '') || null,
    avatar_url: String(meta.avatar_url ?? '') || null,
    interests: interests.length ? interests : (['Life'] as Category[]),
  });
}

export type SignInResult =
  | { ok: true; value: User | null }
  | { ok: false; error: string; needsEmailConfirmation?: boolean };

/**
 * Signs in and, on success, leaves Supabase's session cookies on the response
 * so the person stays signed in across visits until they sign out.
 */
export async function signIn(email: string, password: string): Promise<SignInResult> {
  if (!authConfigured()) return { ok: false, error: AUTH_NOT_CONFIGURED };
  const supabase = await createAuthClient();
  if (!supabase) return { ok: false, error: AUTH_NOT_CONFIGURED };

  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  });

  if (error) {
    const message = error.message.toLowerCase();
    if (message.includes('email not confirmed') || message.includes('not confirmed')) {
      return {
        ok: false,
        error: 'Confirm your email first — check your inbox for the link.',
        needsEmailConfirmation: true,
      };
    }
    // Anything else is reported the same way so this cannot be used to work
    // out which addresses have accounts.
    return { ok: false, error: 'Those details do not match an account.' };
  }

  const profile = data.user ? await profileForAuthUser(data.user) : null;
  if (profile?.status === 'banned') {
    await supabase.auth.signOut();
    return { ok: false, error: 'This account has been banned for breaking the rules.' };
  }
  return { ok: true, value: profile };
}

/**
 * How long a caller should wait before asking for another email.
 *
 * Carried back to the form so the button can count down instead of guessing.
 */
export interface EmailSendOutcome {
  cooldownSeconds: number;
}

/**
 * Reads the number of seconds out of GoTrue's rate-limit message.
 *
 * "For security purposes, you can only request this after 47 seconds." — the
 * figure is the useful part, and showing it beats a vague "try later".
 */
function secondsFrom(message: string, fallback: number): number {
  const found = /after (\d+) seconds?/i.exec(message);
  const parsed = found ? Number(found[1]) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 3600) : fallback;
}

/**
 * Sends the confirmation mail again, through Supabase's own resend.
 *
 * This used to discard the result and report success unconditionally, which is
 * why "send again" appeared to work while no second email ever arrived: a
 * refusal from GoTrue — rate limited, already confirmed, address rejected —
 * looked identical to a send. The result is now read, and a refusal is
 * reported as one.
 *
 * Supabase still owns the whole mechanism: it mints the token, it renders the
 * "Confirm signup" template, it sends. Nothing here creates a token.
 */
export async function resendConfirmation(email: string): Promise<Result<EmailSendOutcome>> {
  if (!authConfigured()) return { ok: false, error: AUTH_NOT_CONFIGURED };
  const supabase = await createAuthClient();
  if (!supabase) return { ok: false, error: AUTH_NOT_CONFIGURED };

  const address = email.trim().toLowerCase();

  const gate = checkEmailSendLimit(address);
  if (!gate.ok) return { ok: false, error: gate.error };

  const { error } = await supabase.auth.resend({
    type: 'signup',
    email: address,
    options: { emailRedirectTo: `${siteUrl()}/auth/callback?next=/home` },
  });

  if (error) {
    const message = error.message ?? '';
    const lowered = message.toLowerCase();

    if (error.status === 429 || lowered.includes('rate limit') || lowered.includes('security purposes')) {
      const wait = secondsFrom(message, EMAIL_COOLDOWN_SECONDS);
      return {
        ok: false,
        error: `Too many requests. Try again in ${wait} second${wait === 1 ? '' : 's'}.`,
      };
    }
    if (lowered.includes('already') && lowered.includes('confirm')) {
      return { ok: false, error: 'That address is already confirmed — you can sign in.' };
    }
    if (lowered.includes('invalid') && lowered.includes('email')) {
      return { ok: false, error: 'That does not look like a valid email address.', field: 'email' };
    }
    // Anything else really is a failure to send, and saying "sent" would be a
    // lie that costs somebody their account.
    return {
      ok: false,
      error: 'We could not send that email just now. Try again in a moment.',
    };
  }

  return { ok: true, value: { cooldownSeconds: EMAIL_COOLDOWN_SECONDS } };
}

export async function signOut(): Promise<void> {
  const supabase = await createAuthClient();
  await supabase?.auth.signOut();
}

/**
 * Sends the password reset link.
 *
 * An address with no account gets the same answer as one with an account —
 * GoTrue returns success either way, and this reports success either way — so
 * the form cannot be used to find out who has an account here.
 *
 * That silence is deliberately narrow. A transport failure or a rate limit is
 * NOT about whether the address exists, so those are reported: telling
 * somebody "check your inbox" when Supabase refused the request leaves them
 * waiting for mail that was never sent.
 */
export async function requestPasswordReset(email: string): Promise<Result<EmailSendOutcome>> {
  if (!authConfigured()) return { ok: false, error: AUTH_NOT_CONFIGURED };
  const supabase = await createAuthClient();
  if (!supabase) return { ok: false, error: AUTH_NOT_CONFIGURED };

  const address = email.trim().toLowerCase();

  const gate = checkEmailSendLimit(address);
  if (!gate.ok) return { ok: false, error: gate.error };

  const { error } = await supabase.auth.resetPasswordForEmail(address, {
    redirectTo: `${siteUrl()}/auth/callback?next=/reset-password`,
  });

  if (error) {
    const message = error.message ?? '';
    const lowered = message.toLowerCase();
    if (error.status === 429 || lowered.includes('rate limit') || lowered.includes('security purposes')) {
      const wait = secondsFrom(message, EMAIL_COOLDOWN_SECONDS);
      return {
        ok: false,
        error: `Too many requests. Try again in ${wait} second${wait === 1 ? '' : 's'}.`,
      };
    }
    // A 4xx about the address itself is answered with the same generic
    // success as a hit, so nothing here distinguishes the two cases.
    if (error.status && error.status >= 500) {
      return { ok: false, error: 'We could not send that email just now. Try again in a moment.' };
    }
  }

  return { ok: true, value: { cooldownSeconds: EMAIL_COOLDOWN_SECONDS } };
}

/**
 * Sets a new password for the person currently holding a recovery session.
 *
 * The session comes from the emailed link going through /auth/callback, and
 * Supabase is what turns that one-time code into a session — there is no
 * FayTarra reset token, and this code never sees a hash.
 *
 * Every other session is then ended. A reset is very often somebody taking an
 * account back, and leaving whoever else was signed in still signed in would
 * defeat the point of the reset.
 */
export async function updatePassword(password: string): Promise<Result<true>> {
  if (password.length < 8) {
    return { ok: false, error: 'Password must be at least 8 characters.', field: 'password' };
  }
  const supabase = await createAuthClient();
  if (!supabase) return { ok: false, error: AUTH_NOT_CONFIGURED };

  const { error } = await supabase.auth.updateUser({ password });

  if (error) {
    const message = error.message ?? '';
    const lowered = message.toLowerCase();
    if (lowered.includes('should be different') || lowered.includes('same as')) {
      return {
        ok: false,
        error: 'That is the password you already have. Choose a different one.',
        field: 'password',
      };
    }
    // Supabase's own password policy, which the dashboard controls: its
    // wording tells people what to fix and reveals nothing about the account.
    if (lowered.includes('password')) return { ok: false, error: message, field: 'password' };
    if (lowered.includes('session') || lowered.includes('jwt') || error.status === 401) {
      return { ok: false, error: 'That reset link has expired. Ask for a new one.' };
    }
    return { ok: false, error: 'We could not change the password. Try the link again.' };
  }

  // Signs out everywhere, this browser included, so the new password is what
  // gets somebody back in. Never allowed to fail the reset: the password IS
  // already changed by this point, and saying otherwise would send them round
  // the loop again for nothing.
  try {
    await supabase.auth.signOut({ scope: 'global' });
  } catch {
    // Best effort.
  }

  return { ok: true, value: true };
}

/** Deletes the profile, its content, and the Supabase Auth account. */
export async function deleteAccount(userId: string): Promise<void> {
  const store = db();
  const [posts, likes, comments, follows, notifications, ratings] = await Promise.all([
    store.query('posts', { where: { author_id: userId } }),
    store.query('likes', { where: { user_id: userId } }),
    store.query('comments', { where: { user_id: userId } }),
    store.query('follows', { where: { follower_id: userId } }),
    store.query('notifications', { where: { user_id: userId } }),
    store.query('ratings', { where: { rater_id: userId } }),
  ]);
  await Promise.all([
    ...posts.map((row) => store.remove('posts', row.id)),
    ...likes.map((row) => store.remove('likes', row.id)),
    ...comments.map((row) => store.remove('comments', row.id)),
    ...follows.map((row) => store.remove('follows', row.id)),
    ...notifications.map((row) => store.remove('notifications', row.id)),
    ...ratings.map((row) => store.remove('ratings', row.id)),
  ]);
  const inbound = await store.query('follows', { where: { following_id: userId } });
  await Promise.all(inbound.map((row) => store.remove('follows', row.id)));
  await store.remove('users', userId);

  const admin = createAdminAuthClient();
  if (admin) await admin.auth.admin.deleteUser(userId);
  await signOut();
  refreshCommunity();
}

/**
 * Absolute URL for links Supabase emails out.
 *
 * `SITE_URL` is accepted alongside the public name for the same reason as the
 * Supabase keys: it is read at runtime, so setting it on the deployment works
 * without depending on what the build inlined.
 */
export function siteUrl(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL || process.env.SITE_URL;
  if (configured) return configured.replace(/\/$/, '');
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;

  // A production deployment that reaches this line would put
  // `http://localhost:3000` inside a link emailed to a real person, which is
  // the classic "the confirmation link goes to localhost" bug. Say so loudly
  // where somebody reading the logs will see it.
  if (process.env.NODE_ENV === 'production') {
    console.warn(
      '[faytarra] No NEXT_PUBLIC_SITE_URL or SITE_URL is set, so email links ' +
        'would point at localhost. Set it to https://faytarra.com.',
    );
  }
  return 'http://localhost:3000';
}

/**
 * Whether email links can currently be built for a real recipient.
 *
 * Note this is only half the story, and the smaller half: Supabase builds
 * `{{ .ConfirmationURL }}` from the project's own **Site URL**, and falls back
 * to it whenever the `redirectTo` we pass is not on the dashboard's allow
 * list. So a Supabase project still configured with localhost sends localhost
 * links no matter what this app sends. See supabase/templates/README.md.
 */
export function emailLinksLookProduction(): boolean {
  return !/localhost|127\.0\.0\.1/.test(siteUrl());
}
