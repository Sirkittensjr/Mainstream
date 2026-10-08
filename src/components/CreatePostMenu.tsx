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
  VideoIcon,
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
 * Every kind there is, each with its own colour — what the desktop offers.
 *
 * Five, because that is what FayTarra makes: the three text messages, a photo,
 * and a video. Video is one door, the studio's chooser, which offers both
 * recording and choosing a file — the same studio, by the same route, that the
 * `+` and the phone's Record video open. Every href is an existing route; this
 * list only decides how they are offered.
 *
 * The colours are FayTarra's own — the blue, purple and pink the text kinds
 * already carry on the create page, then mint and the sunset orange.
 */
export const CREATE_KINDS = [
  {
    key: 'short-message',
    href: '/create?kind=text&text=short',
    label: TEXT_KIND_COPY.short.label,
    blurb: 'Quick thoughts and updates',
    Icon: BubbleLinesIcon,
    accent: '#38BDF8',
  },
  {
    key: 'story-message',
    href: '/create?kind=text&text=story',
    label: TEXT_KIND_COPY.story.label,
    blurb: 'Tell the full story',
    Icon: StoryIcon,
    accent: '#9B7BFF',
  },
  {
    key: 'big-message',
    href: '/create?kind=text&text=big',
    label: TEXT_KIND_COPY.big.label,
    blurb: 'Make a statement',
    Icon: TextIcon,
    accent: '#FF3D9A',
  },
  {
    key: 'photo',
    href: '/create?kind=photo',
    label: 'Photo',
    blurb: 'Share your photos',
    Icon: ImageIcon,
    accent: '#3DDC97',
  },
  {
    key: 'video',
    href: '/create/video?upload=1',
    label: 'Video',
    blurb: 'Create or upload a video',
    Icon: VideoIcon,
    accent: '#FFB443',
  },
] as const;

type CreateKind = (typeof CREATE_KINDS)[number];

/** One kind, as a coloured tile: its icon on its colour, its name, what it is for. */
function KindTile({
  kind,
  layout,
  onPick,
  attribute,
}: {
  kind: CreateKind;
  /** `row` in a list, `column` across a composer. */
  layout: 'row' | 'column';
  onPick?: () => void;
  attribute: 'data-create-option' | 'data-create-quick';
}) {
  const { Icon } = kind;
  return (
    <Link
      href={kind.href}
      onClick={onPick}
      {...{ [attribute]: kind.key }}
      data-create-accent={kind.accent}
      className={`group flex rounded-2xl border transition hover:-translate-y-0.5 ${
        layout === 'row'
          ? 'min-h-[76px] items-center gap-4 px-4 py-3'
          : 'min-h-[118px] flex-col items-start justify-between gap-3 p-4'
      }`}
      style={{
        borderColor: `${kind.accent}33`,
        backgroundImage: `linear-gradient(150deg, ${kind.accent}1F 0%, ${kind.accent}08 70%)`,
      }}
    >
      <span
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition group-hover:scale-105"
        style={{ backgroundColor: `${kind.accent}2E`, color: kind.accent }}
      >
        <Icon width={21} height={21} />
      </span>
      <span className="min-w-0">
        <span className="block font-semibold leading-tight">{kind.label}</span>
        <span className="mt-0.5 block text-xs leading-snug text-white/50">{kind.blurb}</span>
      </span>
    </Link>
  );
}

export function CreatePostMenu({
  /**
   * `prompt` is the composer row Home wants — wide, quiet, and sitting above the
   * feed. `button` is the one the profile wants, beside Edit profile.
   */
  variant = 'button',
  className = '',
  quiet = false,
}: {
  /** `sidebar` is the desktop navigation's one big Create, with every option. */
  variant?: 'prompt' | 'button' | 'sidebar';
  className?: string;
  /** The `button` as a secondary action, beside a primary one. */
  quiet?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const sidebar = variant === 'sidebar';
  const prompt = variant === 'prompt';

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
      {/* On a desktop, the composer offers every kind at once, in colour —
          one click each. On a phone it stays the card below, which opens the
          sheet. */}
      {prompt && (
        <div className={`card hidden p-5 lg:block ${className}`} data-create-composer>
          <p className="font-display text-lg font-bold">Create post</p>
          <p className="text-sm text-white/45">What are you making today?</p>
          <div className="mt-4 grid grid-cols-5 gap-2.5">
            {CREATE_KINDS.map((kind) => (
              <KindTile key={kind.key} kind={kind} layout="column" attribute="data-create-quick" />
            ))}
          </div>
        </div>
      )}
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
          prompt
            ? `card flex w-full items-center gap-3 p-4 text-left transition hover:bg-white/[0.06] lg:hidden ${className}`
            : sidebar
              ? `btn-primary w-full py-3 text-[15px] ${className}`
              : `${quiet ? 'btn-ghost' : 'btn-primary'} px-6 py-2.5 text-sm ${className}`
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

              {sidebar ? (
                <div className="grid gap-2.5 sm:grid-cols-2">
                  {CREATE_KINDS.map((kind, i) => (
                    <div key={kind.key} className={i === CREATE_KINDS.length - 1 ? 'sm:col-span-2' : ''}>
                      <KindTile
                        kind={kind}
                        layout="row"
                        attribute="data-create-option"
                        onPick={() => setOpen(false)}
                      />
                    </div>
                  ))}
                </div>
              ) : (
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
              )}
            </div>
          </div>
        </Portal>
      )}
    </>
  );
}
