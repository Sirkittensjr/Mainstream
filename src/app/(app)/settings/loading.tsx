import { SkeletonTopBar } from '@/components/Skeleton';

/**
 * Settings is a column of cards rather than a list of rows, so its placeholder
 * is the shape of those cards. Without one, opening Settings sat on the
 * previous page with nothing happening.
 */
export default function Loading() {
  return (
    <>
      <SkeletonTopBar title="Settings" />
      <div className="mx-auto max-w-2xl space-y-6 px-4 pt-4 lg:pt-8">
        {[0, 1, 2].map((index) => (
          <div key={index} className="card animate-pulse p-6">
            <div className="h-4 w-1/3 rounded bg-white/[0.07]" />
            <div className="mt-5 space-y-3">
              <div className="h-11 w-full rounded-2xl bg-white/[0.04]" />
              <div className="h-11 w-full rounded-2xl bg-white/[0.04]" />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
