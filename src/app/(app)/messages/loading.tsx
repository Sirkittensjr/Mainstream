import { SkeletonList } from '@/components/Skeleton';

export default function Loading() {
  return <SkeletonList count={5} title="Messages" />;
}
