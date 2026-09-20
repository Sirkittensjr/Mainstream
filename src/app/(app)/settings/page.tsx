import type { Metadata } from 'next';
import Link from 'next/link';
import { Avatar } from '@/components/Avatar';
import { PageTopBar } from '@/components/PageTopBar';
import { logoutAction } from '@/app/actions';
import { UnblockButton } from './UnblockButton';
import { SettingsForm } from './SettingsForm';
import { DangerZone } from './DangerZone';
import { blockedList } from '@/lib/services/users';
import { requireViewer } from '@/lib/session';
import { supabaseConfigured } from '@/lib/db';

export const metadata: Metadata = { title: 'Settings' };
export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const viewer = await requireViewer('/settings');
  const blocked = await blockedList(viewer.id);

  return (
    <>
      <PageTopBar title="Settings" />
      <div className="mx-auto max-w-2xl space-y-6 px-4 pt-4 lg:pt-8">
        <div className="hidden lg:block">
          <h1 className="font-display text-3xl font-extrabold tracking-tight">Settings</h1>
          <p className="mt-1 text-white/45">
            Signed in as @{viewer.username} · {viewer.rise_points.toLocaleString()} RISE points
          </p>
        </div>

        <section className="card p-6">
          <h2 className="mb-5 font-display text-xl font-bold">Your profile</h2>
          <SettingsForm
            defaults={{
              displayName: viewer.display_name,
              bio: viewer.bio,
              location: viewer.location ?? '',
              goal: viewer.goal,
              avatarUrl: viewer.avatar_url,
              interests: viewer.interests,
            }}
          />
        </section>

        <section className="card p-6">
          <h2 className="font-display text-xl font-bold">Safety</h2>
          <p className="mt-1 text-sm text-white/50">
            Blocking hides your posts from someone and removes any follow between you, both ways.
          </p>
          {blocked.length === 0 ? (
            <p className="mt-4 text-sm text-white/35">You have not blocked anyone.</p>
          ) : (
            <ul className="mt-4 space-y-2">
              {blocked.map((user) => (
                <li key={user.id} className="flex items-center gap-3">
                  <Avatar
                    username={user.username}
                    displayName={user.display_name}
                    src={user.avatar_url}
                    size="sm"
                    href={false}
                  />
                  <span className="flex-1 truncate text-sm">@{user.username}</span>
                  <UnblockButton userId={user.id} />
                </li>
              ))}
            </ul>
          )}
          <Link
            href="/rules"
            className="mt-5 inline-block text-sm font-semibold text-ember hover:underline"
          >
            Read the community rules
          </Link>
        </section>

        <section className="card p-6">
          <h2 className="font-display text-xl font-bold">Account</h2>
          <dl className="mt-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-white/40">Email</dt>
              <dd>{viewer.email}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-white/40">Username</dt>
              <dd>@{viewer.username}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-white/40">Storage</dt>
              <dd>{supabaseConfigured() ? 'Supabase' : 'Local demo data'}</dd>
            </div>
          </dl>
          <form action={logoutAction} className="mt-5">
            <button type="submit" className="btn-ghost w-full">
              Sign out
            </button>
          </form>
          <div className="mt-5 border-t border-white/[0.06] pt-5">
            <DangerZone username={viewer.username} />
          </div>
        </section>

        {viewer.role === 'admin' && (
          <Link href="/admin" className="card block p-6 transition hover:border-white/20">
            <h2 className="font-display text-xl font-bold">Admin dashboard</h2>
            <p className="mt-1 text-sm text-white/50">
              Reports, moderation and platform statistics.
            </p>
          </Link>
        )}

        <div className="pb-10" />
      </div>
    </>
  );
}
