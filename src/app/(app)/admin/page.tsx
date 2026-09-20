import type { Metadata } from 'next';
import Link from 'next/link';
import { PageTopBar } from '@/components/PageTopBar';
import { SectionHeader } from '@/components/EmptyState';
import { ShieldIcon } from '@/components/Icons';
import { adminStats, adminUsers } from '@/lib/services/admin';
import { listReports } from '@/lib/services/moderation';
import { requireAdmin } from '@/lib/session';
import { formatShortDate, timeAgo } from '@/lib/time';
import { ReportActions, UserActions } from './AdminActions';

export const metadata: Metadata = { title: 'Admin' };
export const dynamic = 'force-dynamic';

const TABS = ['overview', 'reports', 'users'] as const;

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; q?: string; status?: string }>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const tab = TABS.includes((params.tab ?? '') as (typeof TABS)[number])
    ? (params.tab as (typeof TABS)[number])
    : 'overview';
  const reportStatus = (params.status === 'all' ? 'all' : 'open') as 'all' | 'open';

  const [stats, reports, users] = await Promise.all([
    adminStats(),
    tab === 'reports' ? listReports(reportStatus) : Promise.resolve([]),
    tab === 'users' ? adminUsers(params.q ?? '') : Promise.resolve([]),
  ]);

  return (
    <>
      <PageTopBar title="Admin" />
      <div className="mx-auto max-w-4xl px-4 pt-4 lg:pt-8">
        <div className="mb-5 flex items-center gap-3">
          <ShieldIcon className="text-ember" />
          <div>
            <h1 className="font-display text-2xl font-extrabold tracking-tight">
              Admin dashboard
            </h1>
            <p className="text-sm text-white/45">
              {stats.totals.openReports} open report
              {stats.totals.openReports === 1 ? '' : 's'} · {stats.totals.users} users
            </p>
          </div>
        </div>

        <nav className="flex gap-2">
          {TABS.map((entry) => (
            <Link
              key={entry}
              href={entry === 'overview' ? '/admin' : `/admin?tab=${entry}`}
              className={`chip capitalize ${tab === entry ? 'chip-active' : 'hover:bg-white/10'}`}
            >
              {entry}
              {entry === 'reports' && stats.totals.openReports > 0 && (
                <span className="rounded-full bg-ember px-1.5 text-[10px] font-bold text-ink-950">
                  {stats.totals.openReports}
                </span>
              )}
            </Link>
          ))}
        </nav>

        {tab === 'overview' && (
          <div className="mt-6 space-y-6 pb-12">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Metric label="Total users" value={stats.totals.users} />
              <Metric label="Posts" value={stats.totals.posts} />
              <Metric label="Comments" value={stats.totals.comments} />
              <Metric label="Likes" value={stats.totals.likes} />
              <Metric label="Follows" value={stats.totals.follows} />
              <Metric label="Challenge entries" value={stats.totals.challengeEntries} />
              <Metric label="Open reports" value={stats.totals.openReports} accent />
              <Metric label="New today" value={stats.newUsers.today} />
            </div>

            <section>
              <SectionHeader title="Active users" subtitle="Counted from real activity" />
              <div className="grid grid-cols-3 gap-3">
                <Metric label="Daily (DAU)" value={stats.active.dau} />
                <Metric label="Weekly (WAU)" value={stats.active.wau} />
                <Metric label="Monthly (MAU)" value={stats.active.mau} />
              </div>
            </section>

            <section>
              <SectionHeader title="New users" />
              <div className="grid grid-cols-3 gap-3">
                <Metric label="Today" value={stats.newUsers.today} />
                <Metric label="This week" value={stats.newUsers.week} />
                <Metric label="This month" value={stats.newUsers.month} />
              </div>
            </section>

            <section className="grid gap-4 lg:grid-cols-2">
              <div className="card p-5">
                <h2 className="font-display text-lg font-bold">Most popular categories</h2>
                <ul className="mt-4 space-y-2">
                  {stats.categories.slice(0, 8).map((entry) => {
                    const max = stats.categories[0]?.posts || 1;
                    return (
                      <li key={entry.category} className="flex items-center gap-3 text-sm">
                        <span className="w-24 shrink-0 text-white/60">{entry.category}</span>
                        <span className="h-2 flex-1 overflow-hidden rounded-full bg-white/[0.07]">
                          <span
                            className="block h-full rounded-full bg-gradient-to-r from-solar to-ember"
                            style={{ width: `${(entry.posts / max) * 100}%` }}
                          />
                        </span>
                        <span className="w-8 text-right text-white/40">{entry.posts}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>

              <div className="card p-5">
                <h2 className="font-display text-lg font-bold">Challenge participation</h2>
                <ul className="mt-4 space-y-2 text-sm">
                  {stats.challengeParticipation.map((entry) => (
                    <li key={entry.title} className="flex justify-between gap-3">
                      <span className="truncate text-white/60">{entry.title}</span>
                      <span className="shrink-0 text-white/40">
                        {entry.entries} entries · {entry.creators} creators
                      </span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="card p-5">
                <h2 className="font-display text-lg font-bold">Most viewed posts</h2>
                <ul className="mt-4 space-y-2 text-sm">
                  {stats.topPosts.map((post) => (
                    <li key={post.id} className="flex items-baseline justify-between gap-3">
                      <Link href={`/post/${post.id}`} className="truncate hover:underline">
                        {post.caption || 'Untitled post'}
                      </Link>
                      <span className="shrink-0 text-white/40">
                        {post.views.toLocaleString()} · @{post.author}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="card p-5">
                <h2 className="font-display text-lg font-bold">Top creators</h2>
                <ul className="mt-4 space-y-2 text-sm">
                  {stats.topCreators.map((entry) => (
                    <li key={entry.user.id} className="flex items-baseline justify-between gap-3">
                      <Link href={`/u/${entry.user.username}`} className="truncate hover:underline">
                        @{entry.user.username}
                      </Link>
                      <span className="shrink-0 text-white/40">
                        L{entry.level} · {entry.points.toLocaleString()} pts ·{' '}
                        {entry.followers.toLocaleString()} followers
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </section>

            <section className="card p-5">
              <h2 className="font-display text-lg font-bold">Newest accounts</h2>
              <ul className="mt-4 space-y-2 text-sm">
                {stats.recentUsers.map((entry) => (
                  <li key={entry.user.id} className="flex items-baseline justify-between gap-3">
                    <Link href={`/u/${entry.user.username}`} className="truncate hover:underline">
                      @{entry.user.username}
                    </Link>
                    <span className="shrink-0 text-white/40">
                      {formatShortDate(entry.joined)} · {entry.status}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        )}

        {tab === 'reports' && (
          <div className="mt-6 pb-12">
            <div className="mb-4 flex gap-2">
              <Link
                href="/admin?tab=reports"
                className={`chip ${reportStatus === 'open' ? 'chip-active' : 'hover:bg-white/10'}`}
              >
                Open
              </Link>
              <Link
                href="/admin?tab=reports&status=all"
                className={`chip ${reportStatus === 'all' ? 'chip-active' : 'hover:bg-white/10'}`}
              >
                All
              </Link>
            </div>

            {reports.length === 0 ? (
              <p className="card p-8 text-center text-sm text-white/40">
                No reports in this view. Quiet is good.
              </p>
            ) : (
              <ul className="space-y-3">
                {reports.map((entry) => (
                  <li key={entry.report.id} className="card p-5">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="chip border-ember/40 bg-ember/10 text-ember">
                        {entry.report.reason}
                      </span>
                      <span className="chip capitalize">{entry.report.target_type}</span>
                      <span className="chip capitalize">{entry.report.status}</span>
                      <span className="ml-auto text-white/30">
                        {timeAgo(entry.report.created_at)}
                      </span>
                    </div>

                    <p className="mt-3 text-sm text-white/70">
                      {entry.target?.type === 'post' && (
                        <>
                          <Link href={`/post/${entry.target.id}`} className="underline">
                            Post
                          </Link>{' '}
                          by @{entry.target.authorUsername}: &ldquo;
                          {entry.target.caption.slice(0, 160) || 'media only'}&rdquo;
                          {entry.target.removed && (
                            <span className="ml-2 text-ember">(already removed)</span>
                          )}
                        </>
                      )}
                      {entry.target?.type === 'user' && (
                        <>
                          User{' '}
                          <Link href={`/u/${entry.target.username}`} className="underline">
                            @{entry.target.username}
                          </Link>{' '}
                          · {entry.target.status}
                        </>
                      )}
                      {entry.target?.type === 'comment' && (
                        <>
                          Comment by @{entry.target.authorUsername}: &ldquo;{entry.target.body}
                          &rdquo;
                        </>
                      )}
                      {!entry.target && <span className="text-white/40">Target no longer exists.</span>}
                    </p>

                    {entry.report.details && (
                      <p className="mt-2 text-sm text-white/40">
                        Reporter note: {entry.report.details}
                      </p>
                    )}
                    {entry.report.resolution && (
                      <p className="mt-2 text-sm text-mint">
                        Resolution: {entry.report.resolution}
                      </p>
                    )}

                    {entry.report.status === 'open' && (
                      <ReportActions reportId={entry.report.id} target={entry.target} />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {tab === 'users' && (
          <div className="mt-6 pb-12">
            <form action="/admin" className="mb-4 flex gap-2">
              <input type="hidden" name="tab" value="users" />
              <input
                name="q"
                defaultValue={params.q ?? ''}
                placeholder="Search username or email"
                className="flex-1"
              />
              <button type="submit" className="btn-ghost px-5">
                Search
              </button>
            </form>

            <ul className="space-y-2">
              {users.map((entry) => (
                <li key={entry.user.id} className="card flex flex-wrap items-center gap-3 p-4">
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/u/${entry.user.username}`}
                      className="font-semibold hover:underline"
                    >
                      @{entry.user.username}
                    </Link>
                    <p className="truncate text-xs text-white/40">
                      {entry.email} · L{entry.level} · {entry.followers} followers · {entry.posts}{' '}
                      posts · {entry.user.status}
                    </p>
                  </div>
                  <UserActions userId={entry.user.id} status={entry.user.status} />
                </li>
              ))}
              {users.length === 0 && (
                <li className="card p-8 text-center text-sm text-white/40">No users matched.</li>
              )}
            </ul>
          </div>
        )}
      </div>
    </>
  );
}

function Metric({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: number;
  accent?: boolean;
}) {
  return (
    <div className={`card p-4 ${accent && value > 0 ? 'border-ember/40' : ''}`}>
      <p className="font-display text-2xl font-extrabold">{value.toLocaleString()}</p>
      <p className="mt-0.5 text-[11px] uppercase tracking-wide text-white/40">{label}</p>
    </div>
  );
}
