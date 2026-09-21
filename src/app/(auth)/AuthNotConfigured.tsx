/**
 * Shown instead of the sign-in and sign-up forms when the deployment has no
 * Supabase Auth credentials.
 *
 * There is deliberately no fallback: FayTarra does not have a second, local
 * way of signing people in, so with Supabase unconfigured there is simply no
 * account system rather than a pretend one.
 */
export function AuthNotConfigured() {
  return (
    <div className="card mt-8 space-y-3 p-6 text-sm text-white/60">
      <p className="label text-fay-soft">Accounts are not available here</p>
      <p>
        This deployment has no Supabase Auth credentials, so accounts are switched off. Browsing
        still works.
      </p>
      <p className="text-white/40">
        Set <code className="rounded bg-white/10 px-1.5 py-0.5">NEXT_PUBLIC_SUPABASE_URL</code> and{' '}
        <code className="rounded bg-white/10 px-1.5 py-0.5">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> to
        turn them on.
      </p>
    </div>
  );
}
