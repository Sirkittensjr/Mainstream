'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Portal } from './Portal';
import { CloseIcon, GalleryIcon, ImageIcon, RecordIcon, TextIcon } from './Icons';

/**
 * The general way in to posting: Photo, Text, Upload video, Record video.
 *
 * The `+` in the bottom navigation stays what it is — one tap to a viewfinder,
 * and nothing in the way. That is the fast, dedicated path and this is not it.
 * This is the general-purpose one, on Home and on your own profile, for the
 * times you know what you want to make and it is not necessarily a recording.
 *
 * Every option is a LINK to somewhere that already exists. Nothing here records,
 * uploads or posts anything:
 *
 *   Photo         /create?kind=photo       the photo-and-caption composer
 *   Text          /create?kind=text        the same composer, leading with words
 *   Upload video  /create/video?upload=1   the studio's chooser door
 *   Record video  /create/video            the studio's camera door — the same
 *                                          VideoStudio the + button opens
 *
 * So "Record video" here and `+` land on exactly the same screen, by the same
 * route, and there is one camera, one editor and one upload path behind both.
 */

const OPTIONS = [
  {
    key: 'photo',
    href: '/create?kind=photo',
    label: 'Photo',
    blurb: 'A picture and something to say.',
    Icon: ImageIcon,
  },
  {
    key: 'text',
    href: '/create?kind=text',
    label: 'Text',
    blurb: 'Just words. No picture needed.',
    Icon: TextIcon,
  },
  {
    key: 'upload-video',
    href: '/create/video?upload=1',
    label: 'Upload video',
    blurb: 'A video you already have.',
    Icon: GalleryIcon,
  },
  {
    key: 'record-video',
    href: '/create/video',
    label: 'Record video',
    blurb: 'Open the camera and film one.',
    Icon: RecordIcon,
  },
] as const;

export function CreatePostMenu({
  /**
   * `prompt` is the composer row Home wants — wide, quiet, and sitting above the
   * feed. `button` is the one the profile wants, beside Edit profile.
   */
  variant = 'button',
  className = '',
}: {
  variant?: 'prompt' | 'button';
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  // Escape closes it, like every other sheet in the app.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-create-post
        className={
          variant === 'prompt'
            ? `card flex w-full items-center gap-3 p-4 text-left transition hover:bg-white/[0.06] ${className}`
            : `btn-primary px-6 py-2.5 text-sm ${className}`
        }
      >
        {variant === 'prompt' ? (
          <>
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-fay/15 text-fay-soft">
              <ImageIcon width={18} height={18} />
            </span>
            <span className="min-w-0">
              <span className="block font-semibold">Create post</span>
              <span className="block text-sm text-white/45">
                Photo, text, or a video — your call.
              </span>
            </span>
          </>
        ) : (
          'Create post'
        )}
      </button>

      {open && (
        <Portal>
          <div
            className="fixed inset-0 z-[60] flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center sm:p-6"
            role="dialog"
            aria-modal="true"
            aria-label="Create post"
          >
            <button
              type="button"
              aria-label="Close"
              tabIndex={-1}
              className="absolute inset-0 cursor-default"
              onClick={() => setOpen(false)}
            />
            <div
              data-create-post-sheet
              className="card safe-bottom relative max-h-[88dvh] w-full max-w-md animate-fade-up overflow-y-auto rounded-b-none p-5 pb-7 sm:rounded-3xl sm:p-6"
            >
              <div className="mb-4 flex items-start justify-between gap-4">
                <div>
                  <h2 className="font-display text-xl font-bold">Create post</h2>
                  <p className="mt-1 text-sm text-white/50">What are you making?</p>
                </div>
                <button type="button" onClick={() => setOpen(false)} aria-label="Close">
                  <CloseIcon />
                </button>
              </div>

              <div className="space-y-2">
                {OPTIONS.map(({ key, href, label, blurb, Icon }) => (
                  <Link
                    key={key}
                    href={href}
                    onClick={() => setOpen(false)}
                    data-create-option={key}
                    // 60px, because these four are the whole point of the sheet
                    // and a thumb should not have to aim.
                    className="flex min-h-[60px] items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-left transition hover:bg-white/[0.07]"
                  >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-white/70">
                      <Icon width={18} height={18} />
                    </span>
                    <span className="min-w-0">
                      <span className="block font-semibold">{label}</span>
                      <span className="block text-xs text-white/45">{blurb}</span>
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </Portal>
      )}
    </>
  );
}
