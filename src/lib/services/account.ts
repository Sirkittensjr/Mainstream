import 'server-only';
import { db, storageIsDurable } from '@/lib/db';
import { AUTH_NOT_CONFIGURED, authConfigured } from '@/lib/supabase/config';
import { createAdminAuthClient, createAuthClient } from '@/lib/supabase/server';
import { CATEGORIES, type Category, type User } from '@/lib/types';
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
  try {
    return await store.insert('users', {
      id,
      email,
      username: seed.username,
      display_name: seed.display_name,
      bio: seed.bio,
      avatar_url: seed.avatar_url,
      location: seed.location,
      interests: seed.interests,
      role: isAdminEmail(email) ? 'admin' : 'user',
      status: 'active',
      status_reason: null,
      trusted: true,
      created_at: now,
      last_active_at: now,
    });
  } catch {
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

/** Sends the confirmation mail again. Reports success either way. */
export async function resendConfirmation(email: string): Promise<Result<true>> {
  if (!authConfigured()) return { ok: false, error: AUTH_NOT_CONFIGURED };
  const supabase = await createAuthClient();
  if (!supabase) return { ok: false, error: AUTH_NOT_CONFIGURED };
  await supabase.auth.resend({
    type: 'signup',
    email: email.trim().toLowerCase(),
    options: { emailRedirectTo: `${siteUrl()}/auth/callback?next=/home` },
  });
  return { ok: true, value: true };
}

export async function signOut(): Promise<void> {
  const supabase = await createAuthClient();
  await supabase?.auth.signOut();
}

/** Sends the reset link. Always reports success, so it cannot enumerate emails. */
export async function requestPasswordReset(email: string): Promise<Result<true>> {
  if (!authConfigured()) return { ok: false, error: AUTH_NOT_CONFIGURED };
  const supabase = await createAuthClient();
  if (!supabase) return { ok: false, error: AUTH_NOT_CONFIGURED };
  await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
    redirectTo: `${siteUrl()}/auth/callback?next=/reset-password`,
  });
  return { ok: true, value: true };
}

/** Sets a new password for the person currently holding a recovery session. */
export async function updatePassword(password: string): Promise<Result<true>> {
  if (password.length < 8) return { ok: false, error: 'Password must be at least 8 characters.' };
  const supabase = await createAuthClient();
  if (!supabase) return { ok: false, error: AUTH_NOT_CONFIGURED };
  const { error } = await supabase.auth.updateUser({ password });
  return error ? { ok: false, error: error.message } : { ok: true, value: true };
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
  return 'http://localhost:3000';
}
