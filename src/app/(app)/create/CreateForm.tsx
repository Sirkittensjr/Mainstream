'use client';

import { useActionState, useRef, useState } from 'react';
import { createPostAction } from '@/app/actions';
import { CloseIcon, ImageIcon } from '@/components/Icons';
import { CATEGORIES, type Media } from '@/lib/types';

export function CreateForm() {
  const [state, formAction, pending] = useActionState<{ error?: string } | null, FormData>(
    createPostAction,
    null,
  );
  const [media, setMedia] = useState<Media[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  async function upload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    setUploadError(null);
    try {
      for (const file of Array.from(files).slice(0, 6 - media.length)) {
        const body = new FormData();
        body.append('file', file);
        const response = await fetch('/api/upload', { method: 'POST', body });
        const result = (await response.json()) as { url?: string; kind?: string; error?: string };
        if (!response.ok || !result.url) {
          setUploadError(result.error ?? 'Upload failed.');
          continue;
        }
        setMedia((current) => [
          ...current,
          { kind: result.kind === 'video' ? 'video' : 'image', url: result.url as string },
        ]);
      }
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="media" value={JSON.stringify(media)} />

      <textarea
        name="caption"
        rows={4}
        maxLength={1200}
        autoFocus
        placeholder="What are you working on? @mention anyone you want to bring in."
        className="w-full text-base"
      />

      {/* Media ---------------------------------------------------------- */}
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
              <button
                type="button"
                aria-label="Remove"
                onClick={() => setMedia((current) => current.filter((_, i) => i !== index))}
                className="absolute right-1 top-1 rounded-full bg-black/70 p-1"
              >
                <CloseIcon width={14} height={14} />
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
              {uploading ? 'Uploading…' : 'Add media'}
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
        {uploadError && <p className="mt-2 text-xs text-fay">{uploadError}</p>}
      </div>

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

      {state?.error && (
        <p className="rounded-2xl border border-fay/40 bg-fay/10 px-4 py-3 text-sm text-fay-soft">
          {state.error}
        </p>
      )}

      <button type="submit" disabled={pending || uploading} className="btn-primary w-full py-4">
        {pending ? 'Posting…' : 'Post'}
      </button>
    </form>
  );
}
