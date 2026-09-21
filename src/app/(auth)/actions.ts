'use server';

import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { newId } from '@/lib/ids';
import { setSessionCookie } from '@/lib/auth/session';
import { signIn, signUp } from '@/lib/services/account';
import { CATEGORIES, type Category } from '@/lib/types';

export interface AuthState {
  error?: string;
}

const AVATAR_TYPES: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

export async function signupAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const interests = formData
    .getAll('interests')
    .map(String)
    .filter((value): value is Category => (CATEGORIES as readonly string[]).includes(value));

  // The avatar rides along with the signup form so we never need an upload
  // endpoint that accepts files from people without an account.
  let avatarUrl: string | null = null;
  const avatar = formData.get('avatar');
  if (avatar instanceof File && avatar.size > 0) {
    const extension = AVATAR_TYPES[avatar.type];
    if (!extension) return { error: 'Profile picture must be a JPG, PNG, WEBP or GIF.' };
    if (avatar.size > 6 * 1024 * 1024) return { error: 'Profile picture must be under 6MB.' };
    avatarUrl = await db().putMedia(
      `${newId()}${extension}`,
      avatar.type,
      new Uint8Array(await avatar.arrayBuffer()),
    );
  }

  const result = await signUp({
    email: String(formData.get('email') || ''),
    username: String(formData.get('username') || ''),
    password: String(formData.get('password') || ''),
    display_name: String(formData.get('display_name') || ''),
    bio: String(formData.get('bio') || ''),
    location: String(formData.get('location') || ''),
    avatar_url: avatarUrl,
    interests,
  });
  if (!result.ok) return { error: result.error };

  await setSessionCookie(result.value.id);
  redirect('/home?tab=recommended');
}

export async function loginAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const result = await signIn(
    String(formData.get('identifier') || ''),
    String(formData.get('password') || ''),
  );
  if (!result.ok) return { error: result.error };
  await setSessionCookie(result.value.id);
  const next = String(formData.get('next') || '/home');
  redirect(next.startsWith('/') ? next : '/home');
}
