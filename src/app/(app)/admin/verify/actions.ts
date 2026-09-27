'use server';

import { redirect } from 'next/navigation';
import { requireAdminAccount } from '@/lib/session';
import { sendAdminCode, verifyAdminCode } from '@/lib/services/admin-step-up';

/**
 * The two things the verification screen can do.
 *
 * Both start by resolving the signed-in ADMIN from the session. A normal
 * account never gets past that line — `requireAdminAccount` sends it to /home —
 * so neither the code nor the verification can be reached, triggered or
 * bypassed by anybody who is not already an administrator.
 */

export interface AdminVerifyState {
  error?: string;
  notice?: string;
  /** Seconds to hold the resend button for. Only set when a code went out. */
  cooldown?: number;
  /** Bumped every submit, so the form reacts to a repeat of the same answer. */
  at?: number;
}

export async function sendAdminCodeAction(): Promise<AdminVerifyState> {
  const admin = await requireAdminAccount();
  const result = await sendAdminCode(admin);
  if (!result.ok) return { error: result.error, at: Date.now() };
  return {
    notice: 'Code sent. Check the admin inbox.',
    cooldown: result.cooldownSeconds,
    at: Date.now(),
  };
}

export async function verifyAdminCodeAction(
  _prev: AdminVerifyState,
  formData: FormData,
): Promise<AdminVerifyState> {
  const admin = await requireAdminAccount();

  // The code goes straight to Supabase to be checked. It is never compared
  // here, never stored, and never logged.
  const result = await verifyAdminCode(admin, String(formData.get('code') || ''));
  if (!result.ok) return { error: result.error, at: Date.now() };

  redirect('/admin');
}
