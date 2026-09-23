import type { Metadata } from 'next';
import { FollowListPage } from '@/components/FollowListPage';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ username: string }>;
}): Promise<Metadata> {
  const { username } = await params;
  return { title: `People who follow @${username}` };
}

export default async function Followers({
  params,
  searchParams,
}: {
  params: Promise<{ username: string }>;
  searchParams: Promise<{ show?: string }>;
}) {
  const [{ username }, { show }] = await Promise.all([params, searchParams]);
  return <FollowListPage username={username} list="followers" show={show} />;
}
