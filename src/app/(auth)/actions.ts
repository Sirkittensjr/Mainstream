'use server';

import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { EXTENSION_FOR, sniffType, type SniffedType } from '@/lib/file-type';
import { newId } from '@/lib/ids';
import {
  requestPasswordReset,
  resendConfirmation,
  signIn,
  signUp,
  updatePassword,
} from '@/lib/services/account';
import { getUserByUsername, updateProfile } from '@/lib/services/users';
import { CATEGORIES, type Category } from '@/lib/types';

export interface AuthState {
  error?: string;
  notice?: string;
}

export async function signupAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const interests = formData
    .getAll('interests')
    .map(String)
    .filter((value): value is Category => (CATEGORIES as readonly string[]).includes(value));

  // The avatar is validated here but only STORED once Supabase has actually
  // created the account. Writing it first would make this an upload endpoint
  // that needs no account at all — free storage for anyone with a script.
  const avatar = formData.get('avatar');
  let avatarBytes: { data: Uint8Array; type: SniffedType } | null = null;
  if (avatar instanceof File && avatar.size > 0) {
    if (avatar.size > 6 * 1024 * 1024) return { error: 'Profile picture must be under 6MB.' };
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
  if (!result.ok) return { error: result.error };

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
  redirect(next.startsWith('/') && !next.startsWith('//') ? next : '/home');
}

export async function resendConfirmationAction(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const email = String(formData.get('email') || '');
  if (!email.includes('@')) return { error: 'Enter the email address you signed up with.' };
  const result = await resendConfirmation(email);
  if (!result.ok) return { error: result.error };
  return { notice: 'Sent. Give it a minute and check your spam folder too.' };
}

export async function forgotPasswordAction(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const email = String(formData.get('email') || '');
  if (!email.includes('@')) return { error: 'Enter the email address on your account.' };
  const result = await requestPasswordReset(email);
  if (!result.ok) return { error: result.error };
  return { notice: 'If that address has an account, a reset link is on its way.' };
}

export async function resetPasswordAction(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const password = String(formData.get('password') || '');
  if (password !== String(formData.get('confirm') || '')) {
    return { error: 'Those passwords do not match.' };
  }
  const result = await updatePassword(password);
  if (!result.ok) return { error: result.error };
  redirect('/home?tab=recommended');
}
