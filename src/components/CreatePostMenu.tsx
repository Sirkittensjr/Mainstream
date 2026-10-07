'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Portal } from './Portal';
import { TEXT_KIND_COPY } from '@/lib/text-posts';
import {
  BubbleLinesIcon,
  CloseIcon,
  GalleryIcon,
  ImageIcon,
  PlusIcon,
  RecordIcon,
  StoryIcon,
  TextIcon,
} from './Icons';

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

/**
 * Every way in, one step each — what the desktop sidebar's Create opens.
 *
 * The same destinations as above with Text spelled out as its three kinds, so
 * the one Create button is enough on its own: nothing that used to be a
 * separate "New post" or "Record" item is more than a click away. Each is a
 * route that already exists — the text chooser's own links, the composer, and
 * the video studio's two doors.
 */
const FULL_OPTIONS = [
  {
    key: 'short-message',
    href: '/create?kind=text&text=short',
    label: TEXT_KIND_COPY.short.label,
    blurb: TEXT_KIND_COPY.short.hint,
    Icon: BubbleLinesIcon,
  },
  {
    key: 'story-message',
    href: '/create?kind=text&text=story',
    label: TEXT_KIND_COPY.story.label,
    blurb: TEXT_KIND_COPY.story.hint,
    Icon: StoryIcon,
  },
  {
    key: 'big-message',
    href: '/create?kind=text&text=big',
    label: TEXT_KIND_COPY.big.label,
    blurb: TEXT_KIND_COPY.big.hint,
    Icon: TextIcon,
  },
  OPTIONS[0],
  OPTIONS[2],
  OPTIONS[3],
] as const;

export function CreatePostMenu({
  /**
   * `prompt` is the composer row Home wants — wide, quiet, and sitting above the
   * feed. `button` is the one the profile wants, beside Edit profile.
   */
  variant = 'button',
  className = '',
}: {
  /** `sidebar` is the desktop navigation's one big Create, with every option. */
  variant?: 'prompt' | 'button' | 'sidebar';
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const sidebar = variant === 'sidebar';
  const options = sidebar ? FULL_OPTIONS : OPTIONS;

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
        // The sidebar's is marked apart from the page's own Create post: on a
        // phone the sidebar is in the page but hidden, and "the" create button
        // there is still the one on Home or the profile.
        {...(sidebar ? { 'data-sidebar-create': true } : { 'data-create-post': true })}
        className={
          variant === 'prompt'
            ? `card flex w-full items-center gap-3 p-4 text-left transition hover:bg-white/[0.06] ${className}`
            : sidebar
              ? `btn-primary w-full py-3 text-[15px] ${className}`
              : `btn-primary px-6 py-2.5 text-sm ${className}`
        }
      >
        {sidebar ? (
          <>
            <PlusIcon width={19} height={19} strokeWidth={2.4} /> Create
          </>
        ) : variant === 'prompt' ? (
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
              className={`card safe-bottom relative max-h-[88dvh] w-full animate-fade-up overflow-y-auto rounded-b-none p-5 pb-7 sm:rounded-3xl sm:p-6 ${
                sidebar ? 'max-w-xl' : 'max-w-md'
              }`}
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

              <div className={sidebar ? 'grid gap-2 sm:grid-cols-2' : 'space-y-2'}>
                {options.map(({ key, href, label, blurb, Icon }) => (
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
