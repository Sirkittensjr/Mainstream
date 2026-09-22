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

export default async function Followers({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  return <FollowListPage username={username} list="followers" />;
}
