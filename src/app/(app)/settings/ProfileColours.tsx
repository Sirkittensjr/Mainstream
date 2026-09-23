'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { updateProfileColoursAction } from '@/app/actions';
import {
  PROFILE_COLORS,
  PROFILE_DEFAULT,
  profileSkin,
  type ProfileColor,
} from '@/lib/profile-theme';

/**
 * Picking the two colours a profile is painted in.
 *
 * The preview is the real thing: the same `.profile-skin` variables the
 * profile page sets, on a box built the same way, so what somebody sees here
 * is what their profile becomes. Only keys are ever sent — the colours
 * themselves live in one list on the server and the client alike.
 */
export function ProfileColours({
  background,
  box,
}: {
  background: string | null;
  box: string | null;
}) {
  const [bg, setBg] = useState(background ?? PROFILE_DEFAULT);
  const [surface, setSurface] = useState(box ?? PROFILE_DEFAULT);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const skin = profileSkin(bg, surface);
  const isDefault = bg === PROFILE_DEFAULT && surface === PROFILE_DEFAULT;

  function save(nextBg: string, nextBox: string) {
    setError(null);
    setSaved(null);
    startTransition(async () => {
      const result = await updateProfileColoursAction(nextBg, nextBox);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSaved('Saved.');
      // The profile is a different route, so its cached render has to go.
      router.refresh();
    });
  }

  return (
    <div className="space-y-5">
      <div
        className="profile-skin rounded-3xl p-4"
        style={(skin?.style ?? {}) as React.CSSProperties}
      >
        <div className="card p-4">
          <p className="font-display text-lg font-bold">Your profile</p>
          <p className="mt-1 text-sm text-white/50">
            This is how your boxes will look on your background.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="chip">Preview</span>
            <span className="chip chip-active">Posts</span>
          </div>
        </div>
      </div>

      <Swatches
        legend="Background"
        name="profile-bg"
        value={bg}
        onChange={(next) => {
          setBg(next);
          save(next, surface);
        }}
      />
      <Swatches
        legend="Boxes"
        name="profile-box"
        value={surface}
        onChange={(next) => {
          setSurface(next);
          save(bg, next);
        }}
      />

      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={pending || isDefault}
          onClick={() => {
            setBg(PROFILE_DEFAULT);
            setSurface(PROFILE_DEFAULT);
            save(PROFILE_DEFAULT, PROFILE_DEFAULT);
          }}
          className="btn-ghost px-5 py-2.5 text-sm"
        >
          Reset to default
        </button>
        {pending && <span className="text-sm text-white/40">Saving…</span>}
        {!pending && saved && <span className="text-sm text-mint">{saved}</span>}
        {error && <span className="text-sm text-fay">{error}</span>}
      </div>
    </div>
  );
}

function Swatches({
  legend,
  name,
  value,
  onChange,
}: {
  legend: string;
  name: string;
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <fieldset>
      <legend className="label">{legend}</legend>
      <div className="mt-3 flex flex-wrap gap-2">
        <Swatch
          label="Default"
          colour={null}
          selected={value === PROFILE_DEFAULT}
          name={name}
          onSelect={() => onChange(PROFILE_DEFAULT)}
        />
        {PROFILE_COLORS.map((colour) => (
          <Swatch
            key={colour.key}
            label={colour.label}
            colour={colour}
            selected={value === colour.key}
            name={name}
            onSelect={() => onChange(colour.key)}
          />
        ))}
      </div>
    </fieldset>
  );
}

function Swatch({
  label,
  colour,
  selected,
  name,
  onSelect,
}: {
  label: string;
  colour: ProfileColor | null;
  selected: boolean;
  name: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={`${name === 'profile-bg' ? 'Background' : 'Boxes'}: ${label}`}
      title={label}
      onClick={onSelect}
      className={`h-11 w-11 rounded-2xl border-2 transition active:scale-95 ${
        selected ? 'border-white' : 'border-white/15 hover:border-white/40'
      }`}
      style={
        colour
          ? { backgroundColor: colour.hex }
          : { backgroundImage: 'linear-gradient(135deg,#7C5CFF,#FF3D9A 55%,#FFB443)' }
      }
    />
  );
}
