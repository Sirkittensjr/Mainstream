/**
 * The colours a person can paint their own profile in.
 *
 * Two choices: what sits behind the profile, and what the boxes on it are made
 * of. Nothing about the layout changes — these only ever become the value of a
 * handful of CSS custom properties that `.profile-skin` in globals.css reads.
 *
 * What is stored on the user row is a KEY from this list, never a colour. A
 * key that is not in the list resolves to the default, so a value written
 * straight into the database through the REST API can change how somebody's
 * own profile looks and cannot put anything at all into a stylesheet.
 *
 * Each swatch carries its own tone, and the tone decides the text colour that
 * goes on top of it. That is what keeps a yellow box readable without anybody
 * having to think about it.
 */

export type ProfileTone = 'dark' | 'light';

export interface ProfileColor {
  key: string;
  label: string;
  /** The colour itself. */
  hex: string;
  /** 'light' means text on top of it has to be dark. */
  tone: ProfileTone;
  /**
   * A gradient, for the backgrounds that are one. `hex` is then its solid
   * stand-in: what anything that needs ONE colour reads — the text on an
   * active tab is painted in the background colour, for instance.
   */
  gradient?: string;
}

/**
 * Seven hues, each deep and bright, plus black.
 *
 * The deep ones are surfaces to read off; the bright ones are the poppy
 * versions, and they take dark text.
 */
export const PROFILE_COLORS: readonly ProfileColor[] = [
  { key: 'black', label: 'Black', hex: '#07070C', tone: 'dark' },
  { key: 'smoke', label: 'Smoke', hex: '#23232E', tone: 'dark' },
  { key: 'red', label: 'Red', hex: '#5E0F18', tone: 'dark' },
  { key: 'red-bright', label: 'Bright red', hex: '#FF5A6E', tone: 'light' },
  { key: 'orange', label: 'Orange', hex: '#6B2E05', tone: 'dark' },
  { key: 'orange-bright', label: 'Bright orange', hex: '#FF9F45', tone: 'light' },
  { key: 'yellow', label: 'Yellow', hex: '#544603', tone: 'dark' },
  { key: 'yellow-bright', label: 'Bright yellow', hex: '#FFD84D', tone: 'light' },
  { key: 'green', label: 'Green', hex: '#0B3D24', tone: 'dark' },
  { key: 'green-bright', label: 'Bright green', hex: '#4BE08B', tone: 'light' },
  { key: 'blue', label: 'Blue', hex: '#0B2A5E', tone: 'dark' },
  { key: 'blue-bright', label: 'Bright blue', hex: '#5AB5FF', tone: 'light' },
  { key: 'purple', label: 'Purple', hex: '#33125E', tone: 'dark' },
  { key: 'purple-bright', label: 'Bright purple', hex: '#B18BFF', tone: 'light' },
] as const;

/**
 * Backgrounds that are a FayTarra gradient rather than one colour.
 *
 * Backgrounds only: a box has to be one colour to read text off, and the box
 * swatches stay the list above. Five deep ones that take white text and one
 * bright one that takes dark, the same rule the solid colours follow.
 */
export const PROFILE_GRADIENTS: readonly ProfileColor[] = [
  {
    key: 'fay-sunset',
    label: 'FayTarra sunset',
    hex: '#4A1A5E',
    tone: 'dark',
    gradient: 'linear-gradient(135deg, #2E1466 0%, #6E1B5C 52%, #7A3E10 100%)',
  },
  {
    key: 'fay-aurora',
    label: 'Aurora',
    hex: '#2E1A6A',
    tone: 'dark',
    gradient: 'linear-gradient(140deg, #140F45 0%, #3E1A86 48%, #8E2266 100%)',
  },
  {
    key: 'fay-ocean',
    label: 'Ocean',
    hex: '#0C3060',
    tone: 'dark',
    gradient: 'linear-gradient(140deg, #04182F 0%, #0B4473 50%, #3A1A80 100%)',
  },
  {
    key: 'fay-ember',
    label: 'Ember',
    hex: '#4E1420',
    tone: 'dark',
    gradient: 'linear-gradient(140deg, #220810 0%, #6A1A26 50%, #8E4612 100%)',
  },
  {
    key: 'fay-forest',
    label: 'Forest',
    hex: '#0A3529',
    tone: 'dark',
    gradient: 'linear-gradient(140deg, #031A14 0%, #0A4433 52%, #1A5E52 100%)',
  },
  {
    key: 'fay-glow',
    label: 'Glow',
    hex: '#E7A6D6',
    tone: 'light',
    gradient: 'linear-gradient(135deg, #B18BFF 0%, #FF8CC6 52%, #FFC786 100%)',
  },
] as const;

/** The key that means "leave it as FayTarra looks everywhere else". */
export const PROFILE_DEFAULT = 'default';

export function profileColor(key: string | null | undefined): ProfileColor | null {
  if (!key || key === PROFILE_DEFAULT) return null;
  return PROFILE_COLORS.find((colour) => colour.key === key) ?? null;
}

/** A profile background: one of the colours, or one of the gradients. */
export function profileBackground(key: string | null | undefined): ProfileColor | null {
  if (!key || key === PROFILE_DEFAULT) return null;
  return (
    PROFILE_COLORS.find((colour) => colour.key === key) ??
    PROFILE_GRADIENTS.find((gradient) => gradient.key === key) ??
    null
  );
}

/** Is this a key a BACKGROUND may hold? The colours and the gradients. */
export function isProfileBackgroundKey(value: unknown): value is string {
  return (
    isProfileColorKey(value) ||
    (typeof value === 'string' && PROFILE_GRADIENTS.some((gradient) => gradient.key === value))
  );
}

/** Is this a key this deployment knows? Used before anything is stored. */
export function isProfileColorKey(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    (value === PROFILE_DEFAULT || PROFILE_COLORS.some((colour) => colour.key === value))
  );
}

/** The text that goes on a surface of this tone. */
function ink(tone: ProfileTone) {
  return tone === 'light'
    ? {
        ink: '#0A0A12',
        muted: 'rgba(10, 10, 18, 0.66)',
        line: 'rgba(10, 10, 18, 0.16)',
        inset: 'rgba(10, 10, 18, 0.08)',
      }
    : {
        ink: '#FFFFFF',
        muted: 'rgba(255, 255, 255, 0.58)',
        line: 'rgba(255, 255, 255, 0.10)',
        inset: 'rgba(0, 0, 0, 0.22)',
      };
}

export interface ProfileSkin {
  style: Record<string, string>;
  background: ProfileColor | null;
  box: ProfileColor | null;
}

export interface ProfileSkinOptions {
  /**
   * A photo fills the background. Its brightness is unknown and it sits under
   * a dark scrim, so the text on the page itself is treated as on a dark one.
   */
  photo?: boolean;
}

/**
 * The custom properties for one person's choices, or null when they have made
 * none and the profile should look exactly as it always has.
 */
export function profileSkin(
  backgroundKey: string | null | undefined,
  boxKey: string | null | undefined,
  { photo = false }: ProfileSkinOptions = {},
): ProfileSkin | null {
  const background = profileBackground(backgroundKey);
  const box = profileColor(boxKey);
  if (!background && !box && !photo) return null;

  const boxInk = ink(box?.tone ?? 'dark');
  const pageInk = ink(photo ? 'dark' : (background?.tone ?? 'dark'));

  return {
    background,
    box,
    style: {
      '--profile-bg': background?.hex ?? (photo ? '#07070C' : 'transparent'),
      '--profile-bg-image': background?.gradient ?? 'none',
      '--profile-box': box?.hex ?? 'rgba(15, 15, 22, 0.70)',
      '--profile-ink': boxInk.ink,
      '--profile-muted': boxInk.muted,
      '--profile-line': boxInk.line,
      '--profile-inset': boxInk.inset,
      '--profile-page-ink': pageInk.ink,
      '--profile-page-muted': pageInk.muted,
      '--profile-page-line': pageInk.line,
      '--profile-page-inset': pageInk.inset,
    },
  };
}
