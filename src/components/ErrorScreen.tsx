'use client';

import Link from 'next/link';
import { useEffect } from 'react';

/**
 * What people see when a page throws.
 *
 * The default is a blank screen with a stack trace behind it, which reads as
 * "the site is broken" even when it was one flaky query. This says what
 * happened in plain words and gives two ways out.
 */
export function ErrorScreen({
  error,
  reset,
  title = 'That did not load',
  body = 'Something went wrong on our side, not yours. Trying again usually sorts it.',
}: {
  error: Error & { digest?: string };
  reset: () => void;
  title?: string;
  body?: string;
}) {
  useEffect(() => {
    // The digest is what ties this to the server log.
    console.error('[faytarra]', error.digest ?? '', error.message);
  }, [error]);

  return (
    <div className="mx-auto flex max-w-lg flex-col items-center px-5 py-24 text-center">
      <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-solar to-fay text-2xl">
        ✦
      </div>
      <h1 className="font-display text-2xl font-extrabold tracking-tight">{title}</h1>
      <p className="mt-2 text-sm leading-relaxed text-white/50">{body}</p>
      <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
        <button type="button" onClick={reset} className="btn-primary px-6 py-3 text-sm">
          Try again
        </button>
        <Link href="/home" className="btn-ghost px-6 py-3 text-sm">
          Back to the feed
        </Link>
      </div>
      {error.digest && (
        <p className="mt-6 text-[11px] text-white/20">Reference: {error.digest}</p>
      )}
    </div>
  );
}
