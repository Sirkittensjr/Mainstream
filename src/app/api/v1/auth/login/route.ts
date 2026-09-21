import { createToken } from '@/lib/auth/session';
import { signIn } from '@/lib/services/account';
import { apiError, json, serialiseUser } from '@/lib/api';

/**
 * Exchanges credentials for the same signed session token the website uses in
 * a cookie. A native client stores it and sends `Authorization: Bearer <token>`.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    identifier?: string;
    password?: string;
  } | null;
  if (!body?.identifier || !body?.password) {
    return apiError('identifier and password are required', 422);
  }
  const result = await signIn(body.identifier, body.password);
  if (!result.ok) return apiError(result.error, 401);
  return json({ token: createToken(result.value.id), user: serialiseUser(result.value) });
}
