'use client';

/**
 * Asking before something is lost: Delete and Back in the editor, and
 * throwing away the last clip on the camera. Small and low, so the video
 * stays visible behind it and the answer is next to the thumb that asked. A tap
 * outside is the same answer as No.
 */
export function ConfirmSheet({
  kind,
  title,
  detail,
  onNo,
  onYes,
}: {
  kind: 'delete' | 'retake' | 'drop-last';
  title: string;
  detail: string;
  onNo: () => void;
  onYes: () => void;
}) {
  return (
    <div
      {...{ [`data-editor-confirm-${kind}`]: true }}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="absolute inset-0 z-20 flex items-end justify-center"
    >
      <button
        type="button"
        aria-label="No"
        data-editor-confirm-scrim
        onClick={onNo}
        className="absolute inset-0 bg-black/45"
      />
      <div className="safe-bottom relative mb-24 w-[min(18rem,calc(100%-1.5rem))] rounded-2xl border border-white/10 bg-ink-900/95 p-3 shadow-2xl backdrop-blur-xl">
        <p className="text-center text-[15px] font-semibold text-white">{title}</p>
        <p className="mt-0.5 text-center text-[11px] text-white/50">{detail}</p>
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={onNo}
            data-editor-confirm-no
            className="btn-quiet min-h-[44px] flex-1 py-2 text-[14px]"
          >
            No
          </button>
          <button
            type="button"
            onClick={onYes}
            data-editor-confirm-yes
            className="btn-primary min-h-[44px] flex-1 py-2 text-[14px]"
          >
            Yes
          </button>
        </div>
      </div>
    </div>
  );
}
