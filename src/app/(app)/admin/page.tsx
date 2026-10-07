import type { Metadata } from 'next';
import Link from 'next/link';
import { PageTopBar } from '@/components/PageTopBar';
import { SectionHeader } from '@/components/EmptyState';
import { ShieldIcon } from '@/components/Icons';
import { adminStats, adminUsers } from '@/lib/services/admin';
import { listReports } from '@/lib/services/moderation';
import {
  AUTO_REVIEW_THRESHOLD,
  reviewQueue,
  reviewWindowLabel,
  sweepExpiredReviews,
  type ReviewItem,
} from '@/lib/services/auto-review';
import { requireAdmin } from '@/lib/session';
import { formatShortDate, timeAgo, timeLeft, timestamp } from '@/lib/time';
import { suspiciousRaters } from '@/lib/services/rating-integrity';
import { ReportActions, ReviewActions, TrustActions, UserActions } from './AdminActions';

export const metadata: Metadata = { title: 'Admin' };
export const dynamic = 'force-dynamic';

const TABS = ['overview', 'reports', 'integrity', 'users'] as const;

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

  // FayTarra has no scheduler, so the 24-hour expiry is caught up with here,
  // where somebody is looking at the queue anyway. Nothing depends on this
  // having run: an expired review already reads as over everywhere else. This
  // only writes down that the clock, and not a person, ended it.
  if (tab === 'reports') await sweepExpiredReviews();

  const [stats, reports, review, users, raters] = await Promise.all([
    adminStats(),
    tab === 'reports' ? listReports(reportStatus) : Promise.resolve([]),
    tab === 'reports' ? reviewQueue() : Promise.resolve([]),
    tab === 'users' ? adminUsers(params.q ?? '') : Promise.resolve([]),
    tab === 'integrity' ? suspiciousRaters() : Promise.resolve([]),
  ]);

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

        <nav className="flex gap-2">
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
                  title="Under automatic review"
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
          <div className="mt-6 pb-12">
            <section className="mb-8">
              <SectionHeader
                title={`Automatic ${AUTO_REVIEW_THRESHOLD}-report review`}
                subtitle={`Hidden automatically once ${AUTO_REVIEW_THRESHOLD} different accounts report the same post. Not a decision — it comes back on its own after ${reviewWindowLabel()} if nobody looks.`}
              />
              {review.length === 0 ? (
                <p className="card p-6 text-center text-sm text-white/40">
                  Nothing is under automatic review.
                </p>
              ) : (
                <ul className="space-y-3">
                  {review.map((item) => (
                    <li key={item.postId}>
                      <ReviewCard item={item} window={reviewWindowLabel()} />
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <SectionHeader title="All reports" />
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
              <ul className="space-y-3" data-admin-reports>
                {reports.map((entry) => (
                  <li key={entry.report.id} className="card p-5">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="chip border-fay/40 bg-fay/10 text-fay">
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
                            <span className="ml-2 text-fay">(already removed)</span>
                          )}
                          {entry.target.reviewState && (
                            <span className="ml-2 text-solar">
                              {entry.target.reviewState === 'admin_hold'
                                ? '(held for review)'
                                : '(hidden, under automatic review)'}
                            </span>
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
                      {entry.email} · {entry.rating ? `${entry.rating.toFixed(1)} rated` : 'unrated'}{' '}
                      · {entry.followers} followers · {entry.posts} posts · {entry.user.status}
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

/**
 * One post waiting for a human.
 *
 * Shows how many DIFFERENT accounts reported it, what they picked, and what
 * they wrote — and deliberately not who they were. Reporting has to stay
 * something people can do without it becoming a list of names attached to
 * somebody's post.
 */
function ReviewCard({ item, window: reviewWindow }: { item: ReviewItem; window: string }) {
  const held = item.state === 'admin_hold';
  return (
    <div
      // A stable hook for the tests. A post's caption also appears further down
      // the page in the ordinary report list, so "is the caption on the page"
      // cannot tell whether something is in the REVIEW queue — which is the
      // thing worth asserting, and the thing a test got wrong without this.
      data-review-card={item.postId}
      className={`card p-5 ${held ? 'border-solar/40' : 'border-fay/40'}`}
    >
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span
          className={`chip ${
            held ? 'border-solar/40 bg-solar/10 text-solar' : 'border-fay/40 bg-fay/10 text-fay'
          }`}
        >
          {held ? 'Held by an admin' : 'Temporarily hidden'}
        </span>
        <span className="chip">
          {item.uniqueReports} account{item.uniqueReports === 1 ? '' : 's'} reported it
        </span>
        <span className="chip capitalize">{item.video ? 'video' : 'post'}</span>
        <span className="ml-auto text-white/30">
          {held
            ? 'No automatic expiry'
            : item.expiresAt
              ? timeLeft(item.expiresAt)
              : 'No expiry recorded'}
        </span>
      </div>

      <p className="mt-3 text-sm text-white/70">
        <Link href={`/post/${item.postId}`} className="underline">
          {item.video ? 'Video' : 'Post'}
        </Link>{' '}
        by @{item.authorUsername}: &ldquo;{item.caption.slice(0, 200) || 'media only'}&rdquo;
      </p>

      {item.startedAt && (
        <p className="mt-1 text-xs text-white/30">
          Reached the threshold {timeAgo(item.startedAt)} · {timestamp(item.startedAt)}
        </p>
      )}

      {item.reasons.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {item.reasons.map((entry) => (
            <span key={entry.reason} className="chip text-xs">
              {entry.reason} · {entry.count}
            </span>
          ))}
        </div>
      )}

      {item.notes.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm text-white/40">
          {item.notes.map((note, index) => (
            <li key={index}>&ldquo;{note.slice(0, 240)}&rdquo;</li>
          ))}
        </ul>
      )}

      <ReviewActions postId={item.postId} state={item.state} window={reviewWindow} />

      {item.history.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs text-white/40 hover:text-white/70">
            Moderation history ({item.history.length})
          </summary>
          <ul className="mt-2 space-y-1 text-xs text-white/40">
            {item.history.map((event) => (
              <li key={event.id}>
                <span className="text-white/60">{event.action.replace(/_/g, ' ')}</span> ·{' '}
                {timestamp(event.created_at)}
                {event.detail ? ` · ${event.detail}` : ''}
              </li>
            ))}
          </ul>
        </details>
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
