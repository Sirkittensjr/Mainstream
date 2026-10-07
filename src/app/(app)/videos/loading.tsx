/**
 * The Videos feed while it is being built: the same black frame and title, so
 * the screen does not change shape when the first video arrives.
 */
export default function Loading() {
  return (
    <div className="relative bg-black lg:overflow-hidden lg:rounded-3xl" aria-busy="true">
      <div className="absolute inset-x-0 top-0 z-10 px-4 pb-8 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <h1 className="font-display text-lg font-extrabold tracking-tight">Videos</h1>
      </div>
      <div className="flex h-[calc(100dvh-6rem)] items-center justify-center lg:h-[calc(100dvh-2rem)]">
        <span className="h-9 w-9 animate-spin rounded-full border-2 border-white/15 border-t-white/70" />
        <span className="sr-only">Loading videos</span>
      </div>
    </div>
  );
}
