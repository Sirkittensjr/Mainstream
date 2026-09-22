'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { CATEGORIES, type Category } from '@/lib/types';
import { signupAction, type AuthState } from '../actions';

/**
 * Every text control here is CONTROLLED, held in React state rather than left
 * to the DOM.
 *
 * React resets a `<form action={…}>` once the action settles, so with
 * uncontrolled inputs a single missed field — forgetting to pick an interest,
 * say — wiped the email, username, display name, bio and location the person
 * had just typed. Holding the values in state means a failed submit changes
 * nothing except showing the error.
 *
 * The password is the deliberate exception: it is cleared on failure, because
 * leaving a password sitting in a form that just failed is not worth the
 * keystrokes it saves.
 */
export function SignupForm() {
  const [state, formAction, pending] = useActionState<AuthState, FormData>(signupAction, {});

  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [location, setLocation] = useState('');
  const [selected, setSelected] = useState<Category[]>([]);

  // A chosen file cannot be restored from a string, so the File itself is kept
  // and put back on the input after React has reset the form.
  const [avatar, setAvatar] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const avatarInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const input = avatarInput.current;
    if (!input || !avatar || input.files?.length) return;
    try {
      const carrier = new DataTransfer();
      carrier.items.add(avatar);
      input.files = carrier.files;
    } catch {
      // Older browsers refuse this. The preview still shows, and the account is
      // created without the picture rather than the signup failing.
    }
  }, [avatar, state]);

  // Revoke the object URL when it is replaced, rather than leaking one per pick.
  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  useEffect(() => {
    if (state.error) setPassword('');
  }, [state]);

  function toggle(interest: Category) {
    setSelected((current) =>
      current.includes(interest)
        ? current.filter((value) => value !== interest)
        : current.length >= 6
          ? current
          : [...current, interest],
    );
  }

  /** The message for one control, or nothing. */
  const errorFor = (field: AuthState['field']) =>
    state.field === field ? state.error : undefined;

  const fieldError = (field: AuthState['field']) => {
    const message = errorFor(field);
    if (!message) return null;
    return (
      <p id={`${field}-error`} role="alert" className="mt-1.5 text-sm text-fay-soft">
        {message}
      </p>
    );
  };

  const ring = (field: AuthState['field']) =>
    errorFor(field) ? 'border-fay/60 focus:border-fay' : '';

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
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            aria-invalid={Boolean(errorFor('email'))}
            aria-describedby={errorFor('email') ? 'email-error' : undefined}
            className={`w-full ${ring('email')}`}
          />
          {fieldError('email')}
        </div>
        <div>
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
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              aria-invalid={Boolean(errorFor('username'))}
              aria-describedby={errorFor('username') ? 'username-error' : undefined}
              className={`w-full pl-9 ${ring('username')}`}
            />
          </div>
          {fieldError('username')}
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
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            aria-invalid={Boolean(errorFor('password'))}
            aria-describedby={errorFor('password') ? 'password-error' : undefined}
            className={`w-full ${ring('password')}`}
          />
          {fieldError('password')}
          {state.error && !state.field && (
            <p className="mt-1.5 text-xs text-white/35">
              Your details are still here — just re-enter your password.
            </p>
          )}
        </div>
      </fieldset>

      {/* Interests ------------------------------------------------------ */}
      <fieldset>
        <legend className="font-display text-xl font-bold">What are you into?</legend>
        <p className="mb-4 mt-1 text-sm text-white/45">
          Pick a few. It shapes what you see and where you show up.
        </p>
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map((interest) => {
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
        {fieldError('interests')}
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
            ref={avatarInput}
            id="avatar"
            name="avatar"
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0] ?? null;
              setAvatar(file);
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
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              aria-invalid={Boolean(errorFor('display_name'))}
              aria-describedby={errorFor('display_name') ? 'display_name-error' : undefined}
              className={`w-full ${ring('display_name')}`}
            />
            {fieldError('display_name')}
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
          value={bio}
          onChange={(event) => setBio(event.target.value)}
          className="w-full"
        />
        <input
          name="location"
          maxLength={60}
          placeholder="Location (city or country — never an exact address)"
          value={location}
          onChange={(event) => setLocation(event.target.value)}
          className="w-full"
        />
      </fieldset>

      {/* Anything with no particular field of its own. */}
      {state.error && !state.field && (
        <p role="alert" className="rounded-2xl border border-fay/40 bg-fay/10 px-4 py-3 text-sm text-fay-soft">
          {state.error}
        </p>
      )}

      <button type="submit" disabled={pending} className="btn-primary w-full py-4 text-base">
        {pending ? 'Creating your profile…' : 'Create my account'}
      </button>
    </form>
  );
}
