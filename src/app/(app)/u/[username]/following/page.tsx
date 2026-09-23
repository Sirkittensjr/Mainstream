import type { Metadata } from 'next';
import { FollowListPage } from '@/components/FollowListPage';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ username: string }>;
}): Promise<Metadata> {
  const { username } = await params;
  return { title: `People @${username} follows` };
}

export default async function Following({
  params,
  searchParams,
}: {
  params: Promise<{ username: string }>;
  searchParams: Promise<{ show?: string }>;
}) {
  const [{ username }, { show }] = await Promise.all([params, searchParams]);
  return <FollowListPage username={username} list="following" show={show} />;
}
