import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { PageTopBar } from '@/components/PageTopBar';
import { SectionHeader } from '@/components/EmptyState';
import { ShieldIcon } from '@/components/Icons';
import { adminStats, adminUsers } from '@/lib/services/admin';
import {
  listReports,
  moderationLog,
  moderationQueue,
  type QueueItem,
} from '@/lib/services/moderation';
import { sweepExpiredReviews } from '@/lib/services/auto-review';
import { REPORT_HOLD_LIMIT, actionLabel, effectiveStatus } from '@/lib/moderation-rules';
import { isVectorImage } from '@/lib/image';
import { requireAdmin } from '@/lib/session';
import { formatShortDate, timeAgo, timestamp } from '@/lib/time';
import { suspiciousRaters } from '@/lib/services/rating-integrity';
import {
  AccountActions,
  DismissReport,
  OtherReportActions,
  PostDecisions,
  TrustActions,
} from './AdminActions';

export const metadata: Metadata = { title: 'Admin' };
export const dynamic = 'force-dynamic';

const TABS = ['overview', 'reports', 'users', 'integrity', 'log'] as const;

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; q?: string; status?: string; user?: string }>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const tab = TABS.includes((params.tab ?? '') as (typeof TABS)[number])
    ? (params.tab as (typeof TABS)[number])
    : 'overview';
  const reportStatus = (params.status === 'all' ? 'all' : 'open') as 'all' | 'open';

  // Hides from the first version of this expired after 24 hours. New hides do
  // not expire, but a post hidden back then may still be waiting; writing its
  // expiry down here, where somebody is looking anyway, keeps the log honest.
  if (tab === 'reports') await sweepExpiredReviews();

  const [stats, reports, queue, users, raters, log] = await Promise.all([
    adminStats(),
    tab === 'reports' ? listReports(reportStatus) : Promise.resolve([]),
    tab === 'reports' ? moderationQueue() : Promise.resolve({ hidden: [], reported: [] }),
    tab === 'users' ? adminUsers(params.q ?? '') : Promise.resolve([]),
    tab === 'integrity' ? suspiciousRaters() : Promise.resolve([]),
    tab === 'log' ? moderationLog({ username: params.user || undefined }) : Promise.resolve([]),
  ]);
  // Reports about people and comments; posts have the queue above.
  const otherReports = reports.filter((entry) => entry.report.target_type !== 'post');

  return (
    <>
      <PageTopBar title="Admin" />
      <div className="mx-auto max-w-4xl px-4 pt-4 lg:pt-8">
        <div className="mb-5 flex items-center gap-3">
          <ShieldIcon className="text-fay" />
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

        <nav className="flex flex-wrap gap-2">
          {TABS.map((entry) => (
            <Link
              key={entry}
              href={entry === 'overview' ? '/admin' : `/admin?tab=${entry}`}
              className={`chip capitalize ${tab === entry ? 'chip-active' : 'hover:bg-white/10'}`}
            >
              {entry}
              {entry === 'reports' && stats.totals.openReports > 0 && (
                <span className="rounded-full bg-fay px-1.5 text-[10px] font-bold text-ink-950">
                  {stats.totals.openReports}
                </span>
              )}
              {/* Separate from the report count on purpose: something hidden
                  with a clock on it is more urgent than a report in a queue. */}
              {entry === 'reports' && stats.totals.underReview > 0 && (
                <span
                  title="Hidden and waiting for review"
                  className="rounded-full bg-solar px-1.5 text-[10px] font-bold text-ink-950"
                >
                  {stats.totals.underReview}
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
              <Metric label="Ratings cast" value={stats.totals.ratings} />
              <Metric label="Open reports" value={stats.totals.openReports} accent />
              <Metric label="Under review" value={stats.totals.underReview} accent />
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
                            className="block h-full rounded-full bg-gradient-to-r from-solar to-fay"
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
                <h2 className="font-display text-lg font-bold">Best rated</h2>
                <ul className="mt-4 space-y-2 text-sm">
                  {stats.topRated.map((entry) => (
                    <li key={entry.user.id} className="flex items-baseline justify-between gap-3">
                      <Link href={`/u/${entry.user.username}`} className="truncate hover:underline">
                        @{entry.user.username}
                      </Link>
                      <span className="shrink-0 text-white/40">
                        {entry.rating.toFixed(1)} · {Math.round(entry.votes)} ratings ·{' '}
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

        {tab === 'integrity' && (
          <div className="mt-6 space-y-4 pb-12">
            <div className="card p-5">
              <h2 className="font-display text-lg font-bold">Rating integrity</h2>
              <p className="mt-1 text-sm text-white/50">
                Ratings are weighted before they ever reach a score: new accounts count less,
                one rating per person per target, hard daily limits, and weight collapses when
                someone keeps rating the same creator. These are the accounts whose behaviour
                still looks wrong.
              </p>
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Metric label="Ratings cast" value={stats.totals.ratings} />
                <Metric label="Rated posts" value={stats.totals.ratedPosts} />
                <Metric label="Flagged raters" value={raters.length} accent />
                <Metric label="Weight revoked" value={stats.totals.untrusted} />
              </div>
            </div>

            {raters.length === 0 ? (
              <p className="card p-8 text-center text-sm text-white/40">
                No suspicious rating patterns right now.
              </p>
            ) : (
              <ul className="space-y-3">
                {raters.map((entry) => (
                  <li key={entry.user.id} className="card p-5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/u/${entry.user.username}`}
                        className="font-semibold hover:underline"
                      >
                        @{entry.user.username}
                      </Link>
                      {entry.flags.map((flag) => (
                        <span key={flag} className="chip border-fay/40 bg-fay/10 text-xs text-fay">
                          {flag}
                        </span>
                      ))}
                    </div>
                    <p className="mt-2 text-sm text-white/50">
                      {entry.ratingsGiven} ratings given · average {entry.averageScore} · average
                      weight {entry.averageWeight} · {entry.topTargetShare}% aimed at @
                      {entry.topTargetUsername ?? 'unknown'} · {entry.burst24h} in 24h
                    </p>
                    <div className="mt-3">
                      <TrustActions userId={entry.user.id} trusted={entry.user.trusted} />
                    </div>
                  </li>
                ))}
              </ul>
            )}

          </div>
        )}

        {tab === 'reports' && (
          <div className="mt-6 space-y-10 pb-12">
            <section data-queue="hidden">
              <SectionHeader
                title={`Hidden, waiting for review (${queue.hidden.length})`}
                subtitle={`A report from an eligible account hides a post at once until somebody here decides. Nothing expires and nothing is deleted on its own. Each account can have at most ${REPORT_HOLD_LIMIT} posts hidden and waiting.`}
              />
              {queue.hidden.length === 0 ? (
                <p className="card p-6 text-center text-sm text-white/40">Nothing is waiting.</p>
              ) : (
                <ul className="space-y-4">
                  {queue.hidden.map((item) => (
                    <li key={item.post.id}>
                      <QueueCard item={item} />
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section data-queue="reported">
              <SectionHeader
                title={`Reported, still visible (${queue.reported.length})`}
                subtitle="Open reports that could not hide the post: from suspended or flagged accounts, from a reporter at the limit, or filed again after a moderator restored it."
              />
              {queue.reported.length === 0 ? (
                <p className="card p-6 text-center text-sm text-white/40">No open reports about visible posts.</p>
              ) : (
                <ul className="space-y-4">
                  {queue.reported.map((item) => (
                    <li key={item.post.id}>
                      <QueueCard item={item} />
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <SectionHeader title="Reports about people and comments" />
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
                  All, with history
                </Link>
              </div>

              {(reportStatus === 'all' ? reports : otherReports).length === 0 ? (
                <p className="card p-8 text-center text-sm text-white/40">
                  No reports in this view. Quiet is good.
                </p>
              ) : (
                <ul className="space-y-3" data-admin-reports>
                  {(reportStatus === 'all' ? reports : otherReports).map((entry) => (
                    <li key={entry.report.id} className="card p-5">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="chip border-fay/40 bg-fay/10 text-fay">
                          {entry.report.reason}
                        </span>
                        <span className="chip capitalize">{entry.report.target_type}</span>
                        <span className="chip capitalize">{entry.report.status}</span>
                        <span className="ml-auto text-white/30" title={timestamp(entry.report.created_at)}>
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
                            {entry.target.removed && <span className="ml-2 text-fay">(removed)</span>}
                            {entry.target.reviewState && (
                              <span className="ml-2 text-solar">(hidden, in the queue above)</span>
                            )}
                          </>
                        )}
                        {entry.target?.type === 'user' && (
                          <>
                            User{' '}
                            <Link href={`/u/${entry.target.username}`} className="underline">
                              @{entry.target.username}
                            </Link>{' '}
                            · {entry.target.status} ·{' '}
                            <Link
                              href={`/admin?tab=users&q=${encodeURIComponent(entry.target.username)}`}
                              className="underline"
                            >
                              account actions
                            </Link>
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
                      <p className="mt-1 text-xs text-white/40">
                        Reported by{' '}
                        {entry.reporter ? `@${entry.reporter.username}` : 'a deleted account'}
                      </p>

                      {entry.report.details && (
                        <p className="mt-2 text-sm text-white/40">
                          Reporter note: {entry.report.details}
                        </p>
                      )}
                      {entry.report.resolution && (
                        <p className="mt-2 text-sm text-mint">Resolution: {entry.report.resolution}</p>
                      )}

                      {entry.report.status === 'open' && entry.report.target_type !== 'post' && (
                        <OtherReportActions
                          reportId={entry.report.id}
                          target={entry.target ? { type: entry.target.type, id: entry.target.id } : null}
                        />
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
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
                    <p className="break-words text-xs text-white/40">
                      {entry.email} · {entry.rating ? `${entry.rating.toFixed(1)} rated` : 'unrated'}{' '}
                      · {entry.followers} followers · {entry.posts} posts ·{' '}
                      <span data-account-status>{effectiveStatus(entry.user)}</span>
                      {effectiveStatus(entry.user) === 'suspended' &&
                        (entry.user.suspended_until
                          ? ` until ${formatShortDate(entry.user.suspended_until)}`
                          : ' until reinstated')}
                      {entry.user.trusted === false && ' · flagged'}
                    </p>
                    <Link
                      href={`/admin?tab=log&user=${encodeURIComponent(entry.user.username)}`}
                      className="text-xs text-white/40 underline hover:text-white"
                    >
                      Moderation history
                    </Link>
                  </div>
                  <div className="w-full space-y-2 sm:w-auto">
                    <AccountActions
                      userId={entry.user.id}
                      status={effectiveStatus(entry.user) as 'active' | 'suspended' | 'banned'}
                      isAdmin={entry.user.role === 'admin'}
                    />
                    {/* The same flag as the Integrity tab's: a flagged account's
                        ratings carry no weight and its reports hide nothing. */}
                    {entry.user.role !== 'admin' && (
                      <TrustActions userId={entry.user.id} trusted={entry.user.trusted !== false} />
                    )}
                  </div>
                </li>
              ))}
              {users.length === 0 && (
                <li className="card p-8 text-center text-sm text-white/40">No users matched.</li>
              )}
            </ul>
          </div>
        )}
        {tab === 'log' && (
          <div className="mt-6 pb-12">
            <form action="/admin" className="mb-4 flex gap-2">
              <input type="hidden" name="tab" value="log" />
              <input
                name="user"
                defaultValue={params.user ?? ''}
                placeholder="Only what concerns @username"
                className="flex-1"
              />
              <button type="submit" className="btn-ghost px-5">
                Filter
              </button>
            </form>
            {log.length === 0 ? (
              <p className="card p-8 text-center text-sm text-white/40">Nothing logged here yet.</p>
            ) : (
              <ol className="card divide-y divide-white/[0.06]" data-moderation-log>
                {log.map((entry) => (
                  <li key={entry.id} className="p-4 text-sm" data-log-action={entry.action}>
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      <span className="font-semibold text-white">{actionLabel(entry.action)}</span>
                      <span className="text-white/50">
                        {entry.href ? (
                          <Link href={entry.href} className="underline hover:text-white">
                            {entry.target}
                          </Link>
                        ) : (
                          entry.target
                        )}
                      </span>
                      <span className="ml-auto text-xs text-white/30" title={timestamp(entry.createdAt)}>
                        {timestamp(entry.createdAt)}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-white/45">
                      {entry.actor ? `by @${entry.actor}` : 'by FayTarra'}
                      {entry.detail ? ` · ${entry.detail}` : ''}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
      </div>
    </>
  );
}

const STATE_COPY: Record<QueueItem['state'], { label: string; tone: string }> = {
  report_hold: { label: 'Hidden after a report', tone: 'border-fay/40 bg-fay/10 text-fay' },
  admin_hold: { label: 'Kept under review', tone: 'border-solar/40 bg-solar/10 text-solar' },
  visible: { label: 'Visible — reported', tone: 'border-white/15 bg-white/[0.05] text-white/70' },
};

/**
 * One post waiting for a decision, with what it takes to make one: the post
 * itself, who wrote it and when, every report — by whom, how their past
 * reports went, what they said — and everything already done about it.
 *
 * Moderators only. Reporter names and notes are on this page and nowhere else.
 */
function QueueCard({ item }: { item: QueueItem }) {
  const copy = STATE_COPY[item.state];
  return (
    <article
      data-queue-card={item.post.id}
      data-queue-state={item.state}
      className={`card p-4 sm:p-5 ${item.state === 'admin_hold' ? 'border-solar/30' : item.state === 'report_hold' ? 'border-fay/30' : ''}`}
    >
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className={`chip ${copy.tone}`}>{copy.label}</span>
        <span className="chip capitalize" data-queue-kind>
          {item.post.kind}
        </span>
        <span className="chip" data-queue-count>
          {item.openReports} open report{item.openReports === 1 ? '' : 's'} · {item.uniqueReporters} account
          {item.uniqueReporters === 1 ? '' : 's'}
        </span>
        {item.post.contentWarning && <span className="chip">Content warning</span>}
        {item.hiddenAt && (
          <span className="ml-auto text-white/35" title={timestamp(item.hiddenAt)}>
            Hidden {timeAgo(item.hiddenAt) === 'now' ? 'just now' : `${timeAgo(item.hiddenAt)} ago`}
            {item.hiddenBy ? ` by @${item.hiddenBy}’s report` : ''}
          </span>
        )}
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-[180px_minmax(0,1fr)]">
        <MediaPreview item={item} />
        <div className="min-w-0 text-sm">
          <p className="text-white/50">
            By{' '}
            <Link href={`/u/${item.author.username}`} className="font-semibold text-white underline">
              @{item.author.username}
            </Link>
            {item.author.status !== 'active' && (
              <span className="ml-1 text-fay">({item.author.status})</span>
            )}{' '}
            · posted <span title={timestamp(item.post.createdAt)}>{timestamp(item.post.createdAt)}</span>
          </p>
          {item.post.textTitle && (
            <p className="mt-2 font-display text-base font-bold text-white">{item.post.textTitle}</p>
          )}
          <p className="mt-2 whitespace-pre-wrap break-words text-white/80" data-queue-caption>
            {item.post.caption.slice(0, 800) || <span className="text-white/40">No words, media only.</span>}
          </p>
          <Link href={`/post/${item.post.id}`} className="mt-2 inline-block text-xs text-white/45 underline hover:text-white">
            Open the post (visible to moderators while hidden)
          </Link>
          {item.reasons.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {item.reasons.map((entry) => (
                <span key={entry.reason} className="chip text-xs">
                  {entry.reason} · {entry.count}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      <ul className="mt-4 space-y-2" data-queue-reports>
        {item.reports.map((report) => (
          <li
            key={report.id}
            data-queue-report={report.id}
            className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-3 text-sm"
          >
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="chip border-fay/40 bg-fay/10 text-fay">{report.reason}</span>
              <span className="chip capitalize">{report.status}</span>
              {report.holding && <span className="chip border-solar/40 text-solar">Keeps it hidden</span>}
              {report.status === 'open' && report.cleared && (
                <span className="chip" title="Filed again after a moderator dealt with it">
                  Cannot hide it again
                </span>
              )}
              <span className="ml-auto text-white/30" title={timestamp(report.createdAt)}>
                {timestamp(report.createdAt)}
              </span>
            </div>
            {report.reporter ? (
              <p className="mt-2 text-xs text-white/50" data-reporter={report.reporter.username}>
                Reported by{' '}
                <Link href={`/admin?tab=log&user=${encodeURIComponent(report.reporter.username)}`} className="underline">
                  @{report.reporter.username}
                </Link>{' '}
                · {report.reporter.filed} filed · {report.reporter.dismissed} dismissed ·{' '}
                {report.reporter.holding}/{REPORT_HOLD_LIMIT} hidden and waiting
                {!report.reporter.canHide && (
                  <span className="ml-1 text-fay">
                    · {report.reporter.status !== 'active' ? report.reporter.status : 'flagged'}: their
                    reports cannot hide posts
                  </span>
                )}
              </p>
            ) : (
              <p className="mt-2 text-xs text-white/40">Reported by an account since deleted</p>
            )}
            {report.details && <p className="mt-2 text-white/60">&ldquo;{report.details.slice(0, 400)}&rdquo;</p>}
            {report.status === 'open' && <DismissReport reportId={report.id} />}
          </li>
        ))}
      </ul>

      <PostDecisions postId={item.post.id} state={item.state} />

      {item.history.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs text-white/40 hover:text-white/70">
            Moderation history ({item.history.length})
          </summary>
          <ul className="mt-2 space-y-1 text-xs text-white/45">
            {item.history.map((event) => (
              <li key={event.id}>
                <span className="text-white/70">{actionLabel(event.action)}</span>
                {event.actor ? ` by @${event.actor}` : ''} · {timestamp(event.createdAt)}
                {event.detail ? ` · ${event.detail}` : ''}
              </li>
            ))}
          </ul>
        </details>
      )}
    </article>
  );
}

/** The post's picture or video, or its words for a text post. */
function MediaPreview({ item }: { item: QueueItem }) {
  const first = item.post.media[0];
  if (!first) {
    // A text post's words are beside this already; a square of nothing would
    // only push them down on a phone.
    return (
      <div className="flex items-center justify-center rounded-2xl border border-white/[0.07] bg-white/[0.03] p-3 text-center text-xs text-white/50 sm:aspect-square">
        {item.post.kind === 'big' ? 'Big message' : item.post.kind === 'story' ? 'Story' : 'Short message'}
      </div>
    );
  }
  if (first.kind === 'video') {
    return (
      <video
        controls
        preload="none"
        playsInline
        poster={first.poster}
        src={first.url}
        className="aspect-square w-full rounded-2xl bg-black object-contain"
        data-queue-media="video"
      />
    );
  }
  return (
    <div className="relative aspect-square overflow-hidden rounded-2xl bg-ink-850" data-queue-media="image">
      <Image
        src={first.url}
        alt={`Photo by @${item.author.username}`}
        fill
        sizes="180px"
        unoptimized={isVectorImage(first.url)}
        className="object-cover"
      />
      {item.post.media.length > 1 && (
        <span className="absolute bottom-2 right-2 rounded-full bg-black/60 px-2 py-0.5 text-[11px]">
          +{item.post.media.length - 1}
        </span>
      )}
    </div>
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
    <div className={`card p-4 ${accent && value > 0 ? 'border-fay/40' : ''}`}>
      <p className="font-display text-2xl font-extrabold">{value.toLocaleString()}</p>
      <p className="mt-0.5 text-[11px] uppercase tracking-wide text-white/40">{label}</p>
    </div>
  );
}
