'use client';

import { useEffect, type ReactNode } from 'react';
import { CloseIcon } from './Icons';
import { Portal } from './Portal';

/**
 * One sheet, used by every modal in the app.
 *
 * There were three of these — rate, create post, report — written separately,
 * and they had drifted: one closed on Escape and one did not, one closed when
 * you tapped the backdrop and one trapped you until you found the ✕, and only
 * one of them cleared the iPhone home indicator. The ✕ itself was a bare 20px
 * icon in all three, which is half the size a thumb can reliably hit.
 *
 * So the behaviour lives here once: a bottom sheet on a phone, a centred
 * dialog from `sm` up, Escape and backdrop to dismiss, a 44px close button,
 * and the safe-area padding that keeps the last control reachable.
 */
export function Sheet({
  title,
  subtitle,
  onClose,
  children,
  label,
}: {
  title: string;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  /** The dialog's accessible name, when it should differ from the heading. */
  label?: string;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <Portal>
      <div className="sheet-backdrop" role="dialog" aria-modal="true" aria-label={label ?? title}>
        {/* The backdrop dismisses. It is not reachable by keyboard — Escape is
            that route — so it stays out of the tab order. */}
        <button
          type="button"
          aria-hidden
          tabIndex={-1}
          className="absolute inset-0 cursor-default"
          onClick={onClose}
        />
        <div className="sheet-panel">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="font-display text-xl font-bold">{title}</h2>
              {subtitle && <p className="mt-1 text-sm text-white/50">{subtitle}</p>}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="-mr-2 -mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white/60 transition hover:bg-white/[0.08] hover:text-white"
            >
              <CloseIcon />
            </button>
          </div>
          {children}
        </div>
      </div>
    </Portal>
  );
}
