import { SkeletonTopBar } from '@/components/Skeleton';

/** A conversation loading: the bubbles it is about to be. */
export default function Loading() {
  return (
    <>
      <SkeletonTopBar />
      <div className="mx-auto max-w-2xl px-4 pt-4 lg:pt-8">
        <div className="flex animate-pulse flex-col gap-2 pt-6">
          <div className="h-10 w-2/3 rounded-2xl bg-white/[0.05]" />
          <div className="h-10 w-1/2 self-end rounded-2xl bg-fay/10" />
          <div className="h-10 w-3/5 rounded-2xl bg-white/[0.05]" />
          <div className="h-10 w-1/3 self-end rounded-2xl bg-fay/10" />
        </div>
      </div>
    </>
  );
}
