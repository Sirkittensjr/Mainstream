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
 *
 * Picking is local and saving is explicit. Nothing in this component is the
 * state of anybody's profile: the two colours live on the user's row, the
 * profile page renders them from there for every visitor, and this only ever
 * reports what the server said about the write. "Saved" is shown after the
 * database has been read back and confirmed to hold them, never because a
 * button was pressed.
 */
export function ProfileColours({
  background,
  box,
  available,
}: {
  background: string | null;
  box: string | null;
  /** False when this database has not had migration 0005 run against it. */
  available: boolean;
}) {
  const [bg, setBg] = useState(background ?? PROFILE_DEFAULT);
  const [surface, setSurface] = useState(box ?? PROFILE_DEFAULT);
  /** What the server last confirmed it holds. Not what is on screen. */
  const [stored, setStored] = useState({
    bg: background ?? PROFILE_DEFAULT,
    box: box ?? PROFILE_DEFAULT,
  });
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const skin = profileSkin(bg, surface);
  const isDefault = bg === PROFILE_DEFAULT && surface === PROFILE_DEFAULT;
  const dirty = bg !== stored.bg || surface !== stored.box;

  function pick(nextBg: string, nextBox: string) {
    setBg(nextBg);
    setSurface(nextBox);
    setSaved(null);
    setError(null);
  }

  function save(nextBg = bg, nextBox = surface) {
    setError(null);
    setSaved(null);
    startTransition(async () => {
      const result = await updateProfileColoursAction(nextBg, nextBox);
      if (!result.ok) {
        // Nothing is marked as stored: the database did not take it.
        setError(result.error);
        return;
      }
      setStored({ bg: nextBg, box: nextBox });
      setSaved('Saved to your profile. Everyone who visits it sees this.');
      // The profile is a different route, so its cached render has to go.
      router.refresh();
    });
  }

  return (
    <div className="space-y-5">
      {!available && (
        <p className="rounded-2xl border border-fay/40 bg-fay/10 px-4 py-3 text-sm text-fay-soft">
          Profile colours cannot be saved on this deployment yet: its database has not had{' '}
          <span className="font-mono text-[12px]">0005_profile_colours.sql</span> run against it.
          Everything else on this page works as normal.
        </p>
      )}
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
        disabled={!available}
        onChange={(next) => pick(next, surface)}
      />
      <Swatches
        legend="Boxes"
        name="profile-box"
        value={surface}
        disabled={!available}
        onChange={(next) => pick(bg, next)}
      />

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={pending || !available || !dirty}
          onClick={() => save()}
          className="btn-primary px-6 py-2.5 text-sm"
        >
          {pending ? 'Saving…' : 'Save colours'}
        </button>
        <button
          type="button"
          disabled={pending || !available || (isDefault && !dirty)}
          onClick={() => {
            pick(PROFILE_DEFAULT, PROFILE_DEFAULT);
            save(PROFILE_DEFAULT, PROFILE_DEFAULT);
          }}
          className="btn-ghost px-5 py-2.5 text-sm"
        >
          Reset to default
        </button>
        {!pending && dirty && !error && (
          <span className="text-sm text-white/40">Not saved yet.</span>
        )}
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
  disabled,
  onChange,
}: {
  legend: string;
  name: string;
  value: string;
  disabled: boolean;
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
          disabled={disabled}
          onSelect={() => onChange(PROFILE_DEFAULT)}
        />
        {PROFILE_COLORS.map((colour) => (
          <Swatch
            key={colour.key}
            label={colour.label}
            colour={colour}
            selected={value === colour.key}
            name={name}
            disabled={disabled}
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
  disabled,
  onSelect,
}: {
  label: string;
  colour: ProfileColor | null;
  selected: boolean;
  name: string;
  disabled: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      disabled={disabled}
      aria-checked={selected}
      aria-label={`${name === 'profile-bg' ? 'Background' : 'Boxes'}: ${label}`}
      title={label}
      onClick={onSelect}
      className={`h-11 w-11 rounded-2xl border-2 transition active:scale-95 disabled:opacity-40 ${
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
