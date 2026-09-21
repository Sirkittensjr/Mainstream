'use client';

import { useActionState, useState } from 'react';
import { INTERESTS, type Interest } from '@/lib/types';
import { signupAction, type AuthState } from '../actions';

const GOALS = ['100 followers', '1,000 followers', '10,000 followers', 'Get featured once'];

export function SignupForm() {
  const [state, formAction, pending] = useActionState<AuthState, FormData>(signupAction, {});
  const [selected, setSelected] = useState<Interest[]>([]);
  const [preview, setPreview] = useState<string | null>(null);

  function toggle(interest: Interest) {
    setSelected((current) =>
      current.includes(interest)
        ? current.filter((value) => value !== interest)
        : current.length >= 6
          ? current
          : [...current, interest],
    );
  }

  return (
    <form action={formAction} className="mt-8 space-y-8">
      {/* Account -------------------------------------------------------- */}
      <fieldset className="space-y-4">
        <legend className="label mb-2">Your account</legend>
        <div>
          <label className="sr-only" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="Email"
            className="w-full"
          />
        </div>
        <div className="relative">
          <label className="sr-only" htmlFor="username">
            Username
          </label>
          <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-white/40">
            @
          </span>
          <input
            id="username"
            name="username"
            required
            pattern="[A-Za-z0-9_]{3,20}"
            title="3–20 letters, numbers or underscores"
            autoComplete="username"
            placeholder="username"
            className="w-full pl-9"
          />
        </div>
        <div>
          <label className="sr-only" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            placeholder="Password (8+ characters)"
            className="w-full"
          />
        </div>
      </fieldset>

      {/* Interests ------------------------------------------------------ */}
      <fieldset>
        <legend className="font-display text-xl font-bold">
          What are you trying to become?
        </legend>
        <p className="mb-4 mt-1 text-sm text-white/45">Pick everything that fits. Up to six.</p>
        <div className="flex flex-wrap gap-2">
          {INTERESTS.map((interest) => {
            const active = selected.includes(interest);
            return (
              <button
                key={interest}
                type="button"
                onClick={() => toggle(interest)}
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

      {/* Profile -------------------------------------------------------- */}
      <fieldset className="space-y-4">
        <legend className="label mb-2">Your profile</legend>

        <div className="flex items-center gap-4">
          <label
            htmlFor="avatar"
            className="flex h-16 w-16 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-full border border-dashed border-white/20 bg-white/[0.04] text-xs text-white/40"
          >
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview} alt="" className="h-full w-full object-cover" />
            ) : (
              'Photo'
            )}
          </label>
          <input
            id="avatar"
            name="avatar"
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              setPreview(file ? URL.createObjectURL(file) : null);
            }}
          />
          <div className="flex-1">
            <label className="sr-only" htmlFor="display_name">
              Display name
            </label>
            <input
              id="display_name"
              name="display_name"
              required
              maxLength={40}
              placeholder="Display name"
              className="w-full"
            />
            <p className="mt-1.5 text-xs text-white/30">
              Optional photo — you get a generated one until you add it.
            </p>
          </div>
        </div>

        <textarea
          name="bio"
          rows={2}
          maxLength={240}
          placeholder="Short bio — what are you building?"
          className="w-full"
        />
        <input
          name="location"
          maxLength={60}
          placeholder="Location (city or country — never an exact address)"
          className="w-full"
        />

        <div>
          <label className="label" htmlFor="goal">
            Your first goal
          </label>
          <select id="goal" name="goal" defaultValue={GOALS[0]} className="mt-2 w-full">
            {GOALS.map((goal) => (
              <option key={goal} value={goal}>
                {goal}
              </option>
            ))}
          </select>
        </div>
      </fieldset>

      {state.error && (
        <p className="rounded-2xl border border-fay/40 bg-fay/10 px-4 py-3 text-sm text-fay-soft">
          {state.error}
        </p>
      )}

      <button type="submit" disabled={pending} className="btn-primary w-full py-4 text-base">
        {pending ? 'Creating your profile…' : 'Create my account'}
      </button>
    </form>
  );
}
