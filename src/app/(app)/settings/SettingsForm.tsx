'use client';

import { useActionState, useState } from 'react';
import { updateProfileAction } from '@/app/actions';
import { INTERESTS, type Interest } from '@/lib/types';

export function SettingsForm({
  defaults,
}: {
  defaults: {
    displayName: string;
    bio: string;
    location: string;
    goal: string;
    avatarUrl: string | null;
    interests: Interest[];
  };
}) {
  const [state, formAction, pending] = useActionState<
    { ok?: true; message?: string } | null,
    FormData
  >(updateProfileAction, null);
  const [selected, setSelected] = useState<Interest[]>(defaults.interests);
  const [avatar, setAvatar] = useState<string | null>(defaults.avatarUrl);
  const [uploading, setUploading] = useState(false);

  async function uploadAvatar(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    try {
      const body = new FormData();
      body.append('file', file);
      const response = await fetch('/api/upload', { method: 'POST', body });
      const result = (await response.json()) as { url?: string };
      if (result.url) setAvatar(result.url);
    } finally {
      setUploading(false);
    }
  }

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="avatar_url" value={avatar ?? ''} />

      <div className="flex items-center gap-4">
        <label
          htmlFor="avatar-file"
          className="flex h-20 w-20 cursor-pointer items-center justify-center overflow-hidden rounded-full border border-dashed border-white/20 bg-white/[0.04] text-xs text-white/40"
        >
          {avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatar} alt="" className="h-full w-full object-cover" />
          ) : uploading ? (
            '…'
          ) : (
            'Photo'
          )}
        </label>
        <input
          id="avatar-file"
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(event) => uploadAvatar(event.target.files?.[0])}
        />
        <div>
          <p className="text-sm font-semibold">Profile picture</p>
          <p className="text-xs text-white/40">JPG, PNG, WEBP or GIF.</p>
          {avatar && (
            <button
              type="button"
              onClick={() => setAvatar(null)}
              className="mt-1 text-xs text-white/40 underline hover:text-fay"
            >
              Remove
            </button>
          )}
        </div>
      </div>

      <div>
        <label className="label" htmlFor="display_name">
          Display name
        </label>
        <input
          id="display_name"
          name="display_name"
          defaultValue={defaults.displayName}
          maxLength={40}
          className="mt-2 w-full"
        />
      </div>

      <div>
        <label className="label" htmlFor="bio">
          Bio
        </label>
        <textarea
          id="bio"
          name="bio"
          rows={3}
          maxLength={240}
          defaultValue={defaults.bio}
          className="mt-2 w-full"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="location">
            Location
          </label>
          <input
            id="location"
            name="location"
            defaultValue={defaults.location}
            maxLength={60}
            placeholder="City or country only"
            className="mt-2 w-full"
          />
        </div>
        <div>
          <label className="label" htmlFor="goal">
            Current goal
          </label>
          <input
            id="goal"
            name="goal"
            defaultValue={defaults.goal}
            maxLength={60}
            className="mt-2 w-full"
          />
        </div>
      </div>

      <fieldset>
        <legend className="label mb-3">What are you trying to become?</legend>
        <div className="flex flex-wrap gap-2">
          {INTERESTS.map((interest) => {
            const active = selected.includes(interest);
            return (
              <button
                key={interest}
                type="button"
                onClick={() =>
                  setSelected((current) =>
                    current.includes(interest)
                      ? current.filter((value) => value !== interest)
                      : current.length >= 6
                        ? current
                        : [...current, interest],
                  )
                }
                aria-pressed={active}
                className={`chip ${active ? 'chip-active' : 'hover:bg-white/10'}`}
              >
                {interest}
              </button>
            );
          })}
        </div>
        {selected.map((interest) => (
          <input key={interest} type="hidden" name="interests" value={interest} />
        ))}
      </fieldset>

      {state?.message && (
        <p className="rounded-2xl border border-mint/30 bg-mint/10 px-4 py-3 text-sm text-mint">
          {state.message}
        </p>
      )}

      <button type="submit" disabled={pending} className="btn-primary w-full py-4">
        {pending ? 'Saving…' : 'Save profile'}
      </button>
    </form>
  );
}
