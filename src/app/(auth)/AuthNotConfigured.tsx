/**
 * Shown instead of the sign-in and sign-up forms when the deployment has no
 * Supabase Auth credentials.
 *
 * There is deliberately no fallback: FayTarra does not have a second, local
 * way of signing people in, so with Supabase unconfigured there is simply no
 * account system rather than a pretend one.
 *
 * It names the variables that are actually missing, because the usual cause is
 * not "I forgot to set them" but "I set them and the running build predates
 * that" — see src/lib/supabase/config.ts.
 */
export function AuthNotConfigured({ missing }: { missing: string[] }) {
  return (
    <div className="card mt-8 space-y-3 p-6 text-sm text-white/60">
      <p className="label text-fay-soft">Accounts are not available here</p>
      <p>
        This deployment has no Supabase Auth credentials, so signing up and signing in are switched
        off. Browsing still works.
      </p>
      {missing.length > 0 && (
        <p className="text-white/40">
          Missing:{' '}
          {missing.map((name, index) => (
            <span key={name}>
              {index > 0 ? ', ' : ''}
              <code className="rounded bg-white/10 px-1.5 py-0.5">{name}</code>
            </span>
          ))}
          . Set them on the deployment, then redeploy without the build cache.
        </p>
      )}
    </div>
  );
}
