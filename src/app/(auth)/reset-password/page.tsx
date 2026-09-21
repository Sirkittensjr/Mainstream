import type { Metadata } from 'next';
import Link from 'next/link';
import { ResetPasswordForm } from './ResetPasswordForm';
import { getViewer } from '@/lib/session';

export const metadata: Metadata = { title: 'Set a new password' };

/**
 * Only reachable with a live recovery session, which is created by the link in
 * the reset email going through `/auth/callback`. Without one there is nothing
 * to change, so we send people back to ask for a new link.
 */
export default async function ResetPasswordPage() {
  const viewer = await getViewer();

  if (!viewer) {
    return (
      <div className="pt-6">
        <h1 className="font-display text-4xl font-extrabold leading-tight tracking-tight">
          That link has expired.
        </h1>
        <p className="mt-3 text-white/60">
          Reset links are single use and time limited. Ask for a fresh one.
        </p>
        <Link href="/forgot-password" className="btn-primary mt-8 block w-full py-4 text-center">
          Send a new link
        </Link>
      </div>
    );
  }

  return (
    <div className="pt-6">
      <h1 className="font-display text-4xl font-extrabold leading-tight tracking-tight">
        Set a new password.
      </h1>
      <p className="mt-2 text-white/50">
        Signed in as <span className="text-white">@{viewer.username}</span>.
      </p>
      <ResetPasswordForm />
    </div>
  );
}
