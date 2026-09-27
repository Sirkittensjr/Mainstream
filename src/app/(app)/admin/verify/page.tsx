import type { Metadata } from 'next';
import { ShieldIcon } from '@/components/Icons';
import { PageTopBar } from '@/components/PageTopBar';
import { requireAdminAccount } from '@/lib/session';
import { hasAdminVerification } from '@/lib/services/admin-step-up';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AdminVerifyForm } from './AdminVerifyForm';

export const metadata: Metadata = { title: 'Admin verification' };
export const dynamic = 'force-dynamic';

/**
 * The second step, for administrators only.
 *
 * `requireAdminAccount` is the exception to the usual admin guard: this is the
 * one screen that must know who the admin is BEFORE they have verified, so it
 * can send a code to their address. It shows nothing from the dashboard and
 * grants nothing. A normal account never sees it.
 */
export default async function AdminVerifyPage() {
  const admin = await requireAdminAccount();

  // Already through the gate — no reason to ask again.
  if (await hasAdminVerification(admin.id)) redirect('/admin');

  // Enough of the address to recognise it, not enough to hand it to anybody
  // looking over a shoulder.
  const [name, domain] = admin.email.split('@');
  const masked = `${name.slice(0, 2)}${'•'.repeat(Math.max(3, name.length - 2))}@${domain}`;

  return (
    <>
      <PageTopBar title="Admin verification" />
      <div className="mx-auto max-w-md px-4 pt-6 lg:pt-10">
        <div className="mb-5 flex items-center gap-3">
          <ShieldIcon className="text-fay" />
          <h1 className="font-display text-2xl font-extrabold tracking-tight">
            Verify it is you
          </h1>
        </div>

        <p className="text-sm text-white/60">
          The admin dashboard needs a second step. We will email a six-digit code to{' '}
          <span className="font-semibold text-white">{masked}</span>. It expires shortly, works
          once, and asking for a new one cancels the last.
        </p>

        <AdminVerifyForm />

        {/* The password alone is a perfectly good FayTarra session — it just
            is not an admin one. Nobody should be stuck on this screen because
            they cannot reach the inbox right now. /admin stays shut either
            way, which is where the rule actually lives. */}
        <p className="mt-6 text-center text-sm text-white/45">
          <Link href="/home" className="hover:text-fay hover:underline">
            Continue to FayTarra without admin access
          </Link>
        </p>
      </div>
    </>
  );
}
