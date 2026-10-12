/**
 * A hashtag's videos while they are found: the same black frame the Videos
 * feed loads in, so nothing jumps when the first video arrives.
 */
export default function Loading() {
  return (
    <div className="relative bg-black lg:overflow-hidden lg:rounded-3xl" aria-busy="true">
      <div className="flex h-[calc(100dvh-6rem)] items-center justify-center lg:h-[calc(100dvh-2rem)]">
        <span className="h-9 w-9 animate-spin rounded-full border-2 border-white/15 border-t-white/70" />
        <span className="sr-only">Loading videos</span>
      </div>
    </div>
  );
}
