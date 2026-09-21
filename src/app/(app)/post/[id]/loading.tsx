import { SkeletonCard, SkeletonTopBar } from '@/components/Skeleton';

export default function Loading() {
  return (
    <>
      <SkeletonTopBar title="Post" />
      <div className="mx-auto max-w-2xl space-y-4 px-4 pt-4 lg:pt-8">
        <SkeletonCard />
        <SkeletonCard />
      </div>
    </>
  );
}
