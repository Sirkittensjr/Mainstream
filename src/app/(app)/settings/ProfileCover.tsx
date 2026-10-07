'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { updateProfileCoverAction } from '@/app/actions';
import { contentTypeFor, uploadMedia } from '@/lib/video/upload-client';
import { userFacingError } from '@/lib/user-facing-error';

/**
 * The photo behind somebody's profile: upload one, change it, or remove it.
 *
 * Uploaded the way an avatar is — straight to FayTarra's storage — and then
 * saved as an address on the profile, which every visitor's page reads. The
 * colour or gradient chosen below is kept either way: it is what shows while
 * the photo loads, and what the profile goes back to when the photo is removed.
 *
 * Like the colours, "saved" is only said once the server has read the row back
 * and found the photo on it.
 */
export function ProfileCover({
  current,
  available,
}: {
  current: string | null;
  /** False when this database has not had migration 0013 run against it. */
  available: boolean;
}) {
  const [cover, setCover] = useState<string | null>(current);
  const [busy, setBusy] = useState<'upload' | 'save' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const router = useRouter();

  function save(next: string | null, done: string) {
    setBusy('save');
    startTransition(async () => {
      const result = await updateProfileCoverAction(next);
      setBusy(null);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setCover(next);
      setMessage(done);
      router.refresh();
    });
  }

  async function upload(file: File | undefined) {
    if (!file) return;
    setError(null);
    setMessage(null);
    if (!file.type.startsWith('image/')) {
      setError('Choose a picture — JPG, PNG, WEBP or GIF.');
      return;
    }
    setBusy('upload');
    try {
      const uploaded = await uploadMedia(file, contentTypeFor(file));
      save(uploaded.url, 'Your profile now uses this photo. Everyone who visits it sees it.');
    } catch (failure) {
      setBusy(null);
      setError(userFacingError(failure, 'Could not upload that picture. Try another one.'));
    }
  }

  if (!available) {
    return (
      <p className="rounded-2xl border border-fay/40 bg-fay/10 px-4 py-3 text-sm text-fay-soft">
        Background photos cannot be saved on this deployment yet: its database has not had{' '}
        <span className="font-mono text-[12px]">0013_profile_cover.sql</span> run against it. Your
        profile colours below still work.
      </p>
    );
  }

  return (
    <div className="space-y-4" data-profile-cover-settings={cover ? 'photo' : 'colour'}>
      <div className="relative h-36 overflow-hidden rounded-2xl border border-white/10 bg-ink-800">
        {cover ? (
          // A preview of the stored picture, at the size it is shown here.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={cover} alt="Your profile background" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center px-6 text-center text-sm text-white/45">
            No background photo. Your profile uses the colour you pick below.
          </div>
        )}
        {cover && (
          <span className="absolute left-3 top-3 rounded-full bg-black/60 px-3 py-1 text-xs font-semibold text-white backdrop-blur">
            Using a photo background
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label
          htmlFor="profile-cover-file"
          className={`btn-primary cursor-pointer px-5 py-2.5 text-sm ${busy ? 'pointer-events-none opacity-60' : ''}`}
        >
          {busy === 'upload' ? 'Uploading…' : cover ? 'Change photo' : 'Upload photo'}
        </label>
        <input
          id="profile-cover-file"
          type="file"
          accept="image/*"
          className="sr-only"
          data-profile-cover-input
          disabled={busy !== null}
          onChange={(event) => {
            void upload(event.target.files?.[0]);
            event.target.value = '';
          }}
        />
        {cover && (
          <button
            type="button"
            disabled={busy !== null}
            data-profile-cover-remove
            onClick={() => {
              setError(null);
              setMessage(null);
              save(null, 'Photo removed. Your profile uses your colour again.');
            }}
            className="btn-ghost px-5 py-2.5 text-sm"
          >
            Remove photo
          </button>
        )}
        {busy === 'save' && <span className="text-sm text-white/40">Saving…</span>}
      </div>
      {message && <p className="text-sm text-mint">{message}</p>}
      {error && <p className="text-sm text-fay">{error}</p>}
    </div>
  );
}
