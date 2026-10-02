'use client';

import { useActionState, useRef, useState } from 'react';
import { createPostAction } from '@/app/actions';
import { CloseIcon, ImageIcon } from '@/components/Icons';
import { CATEGORIES, type Media } from '@/lib/types';
import { contentTypeFor, uploadMedia } from '@/lib/video/upload-client';

export function CreateForm({
  /**
   * Which of the two things this composer makes somebody came here for.
   *
   * It is emphasis, not a mode: `photo` puts the picker above the caption and
   * focuses neither, `text` focuses the words and leaves the picker underneath.
   * Both post through the same action and NOTHING is removed either way — a text
   * post can still gain a picture and a photo post still wants a caption. A
   * chooser that took things away would be two composers wearing one name.
   */
  lead = 'text',
}: {
  lead?: 'photo' | 'text';
} = {}) {
  const [state, formAction, pending] = useActionState<{ error?: string } | null, FormData>(
    createPostAction,
    null,
  );
  const [media, setMedia] = useState<Media[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  async function upload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    setUploadError(null);
    try {
      for (const file of Array.from(files).slice(0, 6 - media.length)) {
        try {
          // The same route the video editor uses: straight to storage where
          // that is available, because a serverless request body cannot carry
          // a file of any size worth posting.
          const uploaded = await uploadMedia(file, contentTypeFor(file), {
            onProgress: ({ ratio, phase }) =>
              setProgress(phase === 'checking' ? 'Checking…' : `Uploading… ${Math.round(ratio * 100)}%`),
          });
          setMedia((current) => [...current, uploaded]);
        } catch (failure) {
          setUploadError(failure instanceof Error ? failure.message : 'Upload failed.');
        }
      }
    } finally {
      setUploading(false);
      setProgress(null);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  const words = (
    <div>
      <label className="sr-only" htmlFor="caption">
        What do you want to say?
      </label>
      <textarea
        id="caption"
        name="caption"
        rows={4}
        maxLength={1200}
        autoFocus={lead === 'text'}
        placeholder={
          lead === 'photo'
            ? 'Say something about it. @mention anyone you want to bring in.'
            : 'What are you working on? @mention anyone you want to bring in.'
        }
        className="w-full text-base"
      />
    </div>
  );

  const attachments = (
    <div>
      <div className="flex flex-wrap gap-3">
        {media.map((item, index) => (
          <div key={item.url} className="relative h-24 w-24 overflow-hidden rounded-2xl">
            {item.kind === 'video' ? (
              <video src={item.url} className="h-full w-full object-cover" muted />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={item.url} alt="" className="h-full w-full object-cover" />
            )}
            {/* 32px of target rather than 22: it sits on top of the picture
                it removes, so it has to be hittable without being hit by
                accident. */}
            <button
              type="button"
              aria-label="Remove this attachment"
              onClick={() => setMedia((current) => current.filter((_, i) => i !== index))}
              className="absolute right-1 top-1 flex h-8 w-8 items-center justify-center rounded-full bg-black/70 text-white transition hover:bg-black/85"
            >
              <CloseIcon width={16} height={16} />
            </button>
          </div>
        ))}
        {media.length < 6 && (
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            disabled={uploading}
            className="flex h-24 w-24 flex-col items-center justify-center gap-1 rounded-2xl border border-dashed border-white/15 bg-white/[0.03] text-xs text-white/45 transition hover:bg-white/[0.06]"
          >
            <ImageIcon />
            {uploading ? (progress ?? 'Uploading…') : 'Add media'}
          </button>
        )}
      </div>
      <input
        ref={fileInput}
        type="file"
        accept="image/*,video/*"
        multiple
        className="hidden"
        onChange={(event) => upload(event.target.files)}
      />
      <p className="mt-2 text-xs text-white/30">
        Images and video, up to 6 per post. Text-only posts are fine too.
      </p>
      {/* Announced, because an upload is the one thing here that takes long
          enough for somebody to wonder whether it is happening. */}
      <p role="status" className="sr-only">
        {uploading ? (progress ?? 'Uploading') : ''}
      </p>
      {uploadError && (
        <p role="alert" className="mt-2 text-xs text-fay">
          {uploadError}
        </p>
      )}
    </div>
  );

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="media" value={JSON.stringify(media)} />

      {/* Whichever one was asked for goes first. Both are always here. */}
      {lead === 'photo' ? (
        <>
          {attachments}
          {words}
        </>
      ) : (
        <>
          {words}
          {attachments}
        </>
      )}

      {/* Meta ----------------------------------------------------------- */}
      <div>
        <label className="label" htmlFor="category">
          Category
        </label>
        <select id="category" name="category" defaultValue="Life" className="mt-2 w-full">
          {CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {category}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="tags">
          Tags (optional)
        </label>
        <input
          id="tags"
          name="tags"
          placeholder="beats, firstpost, homestudio"
          className="mt-2 w-full"
        />
      </div>

      <label className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <input
          id="content_warning"
          name="content_warning"
          type="checkbox"
          className="mt-0.5 h-5 w-5 shrink-0 rounded accent-fay"
        />
        <span>
          <span className="block text-sm font-semibold">Content warning</span>
          <span className="block text-xs text-white/45">
            What you attach stays covered until somebody chooses to see it.
          </span>
        </span>
      </label>

      {state?.error && (
        <p role="alert" className="rounded-2xl border border-fay/40 bg-fay/10 px-4 py-3 text-sm text-fay-soft">
          {state.error}
        </p>
      )}

      {/* Says why it is unavailable rather than just going grey. */}
      <button type="submit" disabled={pending || uploading} className="btn-primary w-full py-4">
        {pending ? 'Posting…' : uploading ? 'Waiting for the upload…' : 'Post'}
      </button>
    </form>
  );
}
