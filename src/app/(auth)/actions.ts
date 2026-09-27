'use server';

import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { AVATAR_BUDGET_BYTES } from '@/lib/media/avatar-image';
import { EXTENSION_FOR, sniffType, type SniffedType } from '@/lib/file-type';
import { newId } from '@/lib/ids';
import {
  requestPasswordReset,
  resendConfirmation,
  signIn,
  signUp,
  updatePassword,
  type SignUpField,
} from '@/lib/services/account';
import { sendAdminCode } from '@/lib/services/admin-step-up';
import { getUserByUsername, updateProfile } from '@/lib/services/users';
import { CATEGORIES, type Category } from '@/lib/types';

/** One shared shape for "is this even an email address". */
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export interface AuthState {
  error?: string;
  /** Which control the error belongs to, so the form can show it in place. */
  field?: SignUpField;
  notice?: string;
  /**
   * Seconds the form should hold the button for before another send is worth
   * attempting. Only set when an email actually went out.
   */
  cooldown?: number;
  /** Bumped on every submit, so a form can react to a repeat of the same answer. */
  at?: number;
}

export async function signupAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const interests = formData
    .getAll('interests')
    .map(String)
    .filter((value): value is Category => (CATEGORIES as readonly string[]).includes(value));

  // The avatar is validated here but only STORED once Supabase has actually
  // created the account. Writing it first would make this an upload endpoint
  // that needs no account at all — free storage for anyone with a script.
  //
  // It is the one file on FayTarra that travels inside a Server Action, for
  // that reason, and a Server Action body stops at 1MB — so the browser shrinks
  // it to `AVATAR_BUDGET_BYTES` before submitting (see lib/media/avatar-image).
  // The ceiling here is that budget with room to spare: generous enough never
  // to argue with a legitimately prepared picture, small enough that a submit
  // which skipped the browser is refused with a sentence rather than killed by
  // the runtime with a 413 nobody can read.
  const avatar = formData.get('avatar');
  let avatarBytes: { data: Uint8Array; type: SniffedType } | null = null;
  if (avatar instanceof File && avatar.size > 0) {
    if (avatar.size > 2 * AVATAR_BUDGET_BYTES) {
      return { error: 'That profile picture is too large to send. Try a smaller one.' };
    }
    const data = new Uint8Array(await avatar.arrayBuffer());
    const type = sniffType(data);
    if (!type || !type.startsWith('image/')) {
      return { error: 'Profile picture must be a JPG, PNG, WEBP or GIF.' };
    }
    avatarBytes = { data, type };
  }

  const email = String(formData.get('email') || '');
  const result = await signUp({
    email,
    username: String(formData.get('username') || ''),
    password: String(formData.get('password') || ''),
    display_name: String(formData.get('display_name') || ''),
    bio: String(formData.get('bio') || ''),
    location: String(formData.get('location') || ''),
    avatar_url: null,
    interests,
  });
  if (!result.ok) return { error: result.error, field: result.field };

  if (avatarBytes) {
    try {
      const url = await db().putMedia(
        `${newId()}${EXTENSION_FOR[avatarBytes.type]}`,
        avatarBytes.type,
        avatarBytes.data,
      );
      await updateProfile(result.value.userId, { avatar_url: url });
    } catch {
      // A picture is not worth failing the signup over — they can add one in
      // settings.
    }
  }

  // Supabase sends the confirmation mail. There is no session until the link
  // is followed, so there is nothing to log in to yet.
  if (result.value.needsEmailConfirmation) {
    redirect(`/verify-email?email=${encodeURIComponent(email.trim().toLowerCase())}`);
  }
  redirect('/home?tab=recommended');
}

export async function loginAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const identifier = String(formData.get('identifier') || '').trim();
  const password = String(formData.get('password') || '');

  // Supabase signs people in by email, so a username has to be resolved first.
  let email = identifier.toLowerCase();
  if (email && !email.includes('@')) {
    const profile = await getUserByUsername(email);
    // A miss still goes to Supabase with an address that cannot exist, so the
    // reply is the same either way and usernames cannot be probed from here.
    email = profile?.email ?? `${email}@invalid.faytarra`;
  }

  const result = await signIn(email, password);
  if (!result.ok) {
    if (result.needsEmailConfirmation) {
      redirect(`/verify-email?email=${encodeURIComponent(email)}&resend=1`);
    }
    return { error: result.error };
  }

  const next = String(formData.get('next') || '/home');
  const target = next.startsWith('/') && !next.startsWith('//') ? next : '/home';

  // An administrator has a second step. The password alone is a normal
  // FayTarra session — it opens the feed, not the dashboard — so the code goes
  // out now and they land on the screen that asks for it.
  //
  // A send that fails is not a reason to stop: the screen has a button, and
  // being unable to email a code must not lock an admin out of the site
  // itself.
  if (result.value?.role === 'admin') {
    await sendAdminCode(result.value).catch(() => undefined);
    redirect(`/admin/verify?next=${encodeURIComponent(target)}`);
  }

  redirect(target);
}

export async function resendConfirmationAction(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const email = String(formData.get('email') || '').trim();
  if (!EMAIL_RE.test(email)) {
    return { error: 'Enter the email address you signed up with.', field: 'email', at: Date.now() };
  }

  const result = await resendConfirmation(email);
  if (!result.ok) return { error: result.error, field: result.field, at: Date.now() };

  return {
    notice: 'Verification email sent. Check your inbox.',
    cooldown: result.value.cooldownSeconds,
    at: Date.now(),
  };
}

export async function forgotPasswordAction(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const email = String(formData.get('email') || '').trim();
  if (!EMAIL_RE.test(email)) {
    return { error: 'Enter a valid email address.', field: 'email', at: Date.now() };
  }

  const result = await requestPasswordReset(email);
  if (!result.ok) return { error: result.error, at: Date.now() };

  // Deliberately the same sentence whether or not that address has an account.
  return {
    notice:
      'If an account exists for that email address, we have sent a password reset link. ' +
      'Give it a minute, and check your spam folder too.',
    cooldown: result.value.cooldownSeconds,
    at: Date.now(),
  };
}

/**
 * Sets the new password, for somebody holding a live recovery session.
 *
 * On success it lands on the login page rather than reporting in place. The
 * last thing `updatePassword` does is end every session, this browser's
 * included, so a success message rendered here would be wiped the moment the
 * page re-rendered without a session — and the thing to do next really is to
 * sign in with the new password, which is what proves it took.
 */
export async function resetPasswordAction(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const password = String(formData.get('password') || '');
  const confirm = String(formData.get('confirm') || '');

  if (password.length < 8) {
    return { error: 'Password must be at least 8 characters.', field: 'password', at: Date.now() };
  }
  if (password !== confirm) {
    return { error: 'Those passwords do not match.', field: 'password', at: Date.now() };
  }

  const result = await updatePassword(password);
  if (!result.ok) return { error: result.error, field: result.field, at: Date.now() };

  redirect('/login?reset=done');
}
