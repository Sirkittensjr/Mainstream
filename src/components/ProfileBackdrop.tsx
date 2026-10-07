import Image from 'next/image';
import { isVectorImage } from '@/lib/image';
import type { ProfileColor } from '@/lib/profile-theme';

/**
 * What a profile is painted on: its owner's photo, gradient or colour, behind
 * the WHOLE page.
 *
 * Fixed to the viewport and beneath everything, so the navigation, the profile
 * and the rail all sit inside it rather than the colour stopping at the edges
 * of the middle column. Nothing here takes a click.
 *
 * A photo is drawn by next/image at the viewport's width — a phone is sent a
 * phone-sized copy and a desktop a desktop-sized one, never the original off
 * somebody's camera — cropped to fill rather than stretched, under a dark
 * scrim so white text and the avatar stay readable whatever the picture is.
 * The colour under it is the owner's chosen one, which is what shows while the
 * photo loads and what the profile falls back to without it.
 */
export function ProfileBackdrop({
  background,
  photo,
}: {
  background: ProfileColor | null;
  photo: string | null;
}) {
  if (!background && !photo) return null;
  return (
    <div
      aria-hidden
      data-profile-backdrop={photo ? 'photo' : background?.gradient ? 'gradient' : 'colour'}
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
      style={{
        backgroundColor: background?.hex ?? '#07070C',
        backgroundImage: background?.gradient,
      }}
    >
      {photo && (
        <>
          <Image
            src={photo}
            alt=""
            fill
            priority
            sizes="100vw"
            quality={70}
            unoptimized={isVectorImage(photo)}
            className="object-cover"
            data-profile-backdrop-photo
          />
          <span
            className="absolute inset-0"
            style={{
              backgroundImage:
                'linear-gradient(180deg, rgba(7,7,12,0.30) 0%, rgba(7,7,12,0.50) 40%, rgba(7,7,12,0.80) 100%)',
            }}
          />
        </>
      )}
    </div>
  );
}
