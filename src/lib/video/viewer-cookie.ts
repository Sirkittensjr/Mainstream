/**
 * The cookie that identifies a browser nobody has signed in on.
 *
 * Opaque, random, and used for one thing: deduplicating video views from a
 * visitor. Not tied to an account, not readable by script, and it carries no
 * information about the person beyond "the same browser as last time".
 *
 * The middleware hands one to every visitor on their first page, so it is
 * already there when their first view is reported — and a retry of that report
 * is recognised as the same browser, rather than counted again as somebody new
 * because the answer that would have set the cookie never arrived.
 *
 * No imports: the middleware runs on the edge and reads this too.
 */
export const VIEW_BROWSER_COOKIE = 'fay_viewer';

export const VIEW_BROWSER_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: 60 * 60 * 24 * 365,
} as const;
