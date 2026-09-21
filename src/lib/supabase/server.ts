import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { SUPABASE_ANON_KEY, SUPABASE_URL, authConfigured } from './config';

/**
 * Request-scoped Supabase client for authentication.
 *
 * It reads and writes the auth cookies Supabase manages, so a signed-in person
 * stays signed in as they move around the site and their access token is
 * refreshed transparently.
 *
 * This client is for AUTH only. Application data goes through the service-role
 * driver in `src/lib/db`, where FayTarra's own rules (blocking, moderation,
 * rating integrity) are enforced in one place.
 */
export async function createAuthClient() {
  if (!authConfigured()) return null;
  const cookieStore = await cookies();

  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component, where cookies are read-only. The
          // middleware refreshes the session, so this is safe to ignore.
        }
      },
    },
  });
}

/**
 * Admin client, service-role. Used for the few things only a trusted server
 * may do: deleting a half-created account, and seeding demo accounts.
 */
export function createAdminAuthClient() {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !serviceKey) return null;
  return createServerClient(SUPABASE_URL, serviceKey, {
    cookies: { getAll: () => [], setAll: () => {} },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
