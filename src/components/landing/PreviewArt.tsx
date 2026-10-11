import { useId } from 'react';
import type { PreviewArt as Art } from '@/lib/landing';

/**
 * Illustrations for the landing page's preview cards.
 *
 * Drawn rather than photographed, on purpose: a preview card stands in for the
 * kind of thing people post, and a drawing cannot be mistaken for somebody's
 * actual photo of their actual cat. Inline SVG, so they cost no request and
 * nothing to decode. Each fills its box (`slice`), whatever its shape.
 */
export function PreviewArt({ art }: { art: Art }) {
  const id = useId().replace(/:/g, '');
  const Scene = SCENES[art];
  return (
    <svg
      viewBox="0 0 400 500"
      preserveAspectRatio="xMidYMid slice"
      className="h-full w-full"
      aria-hidden
      focusable="false"
    >
      <Scene id={id} />
    </svg>
  );
}

type SceneProps = { id: string };

function Nature({ id }: SceneProps) {
  return (
    <>
      <defs>
        <linearGradient id={`${id}-sky`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2B1247" />
          <stop offset="0.45" stopColor="#A2346F" />
          <stop offset="0.72" stopColor="#FF7A59" />
          <stop offset="1" stopColor="#FFC56B" />
        </linearGradient>
        <radialGradient id={`${id}-sun`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#FFF1C2" />
          <stop offset="0.5" stopColor="#FFD27A" stopOpacity="0.9" />
          <stop offset="1" stopColor="#FFB443" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}-mist`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFB4A0" stopOpacity="0" />
          <stop offset="1" stopColor="#FFB4A0" stopOpacity="0.45" />
        </linearGradient>
      </defs>
      <rect width="400" height="500" fill={`url(#${id}-sky)`} />
      <circle cx="250" cy="300" r="120" fill={`url(#${id}-sun)`} />
      <circle cx="250" cy="300" r="42" fill="#FFE6A8" />
      <path d="M0 330 L70 270 L120 300 L190 225 L250 290 L300 250 L400 320 V500 H0Z" fill="#7A2E6B" opacity="0.85" />
      <rect y="300" width="400" height="60" fill={`url(#${id}-mist)`} />
      <path d="M0 380 L60 330 L130 370 L210 300 L290 365 L350 330 L400 360 V500 H0Z" fill="#4A1C55" />
      <path d="M0 440 L80 395 L160 430 L240 385 L330 435 L400 405 V500 H0Z" fill="#24102F" />
      <path d="M0 500 V470 Q100 445 200 465 T400 455 V500Z" fill="#12081A" />
      <g fill="none" stroke="#2B1247" strokeWidth="3" strokeLinecap="round" opacity="0.7">
        <path d="M92 150 q8 -8 16 0 q8 -8 16 0" />
        <path d="M138 128 q6 -6 12 0 q6 -6 12 0" />
        <path d="M120 180 q5 -5 10 0 q5 -5 10 0" />
      </g>
    </>
  );
}

function Cat({ id }: SceneProps) {
  return (
    <>
      <defs>
        <linearGradient id={`${id}-room`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2A1A3F" />
          <stop offset="1" stopColor="#4A2546" />
        </linearGradient>
        <linearGradient id={`${id}-night`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1A2050" />
          <stop offset="1" stopColor="#5B3A8C" />
        </linearGradient>
        <radialGradient id={`${id}-lamp`} cx="0.15" cy="0.85" r="0.7">
          <stop offset="0" stopColor="#FFB443" stopOpacity="0.45" />
          <stop offset="1" stopColor="#FFB443" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="400" height="500" fill={`url(#${id}-room)`} />
      <rect x="70" y="60" width="260" height="270" rx="18" fill={`url(#${id}-night)`} />
      <circle cx="262" cy="130" r="30" fill="#FFF1C2" />
      <circle cx="274" cy="122" r="26" fill="#2A2A66" opacity="0.55" />
      <g fill="#FFFFFF">
        <circle cx="120" cy="105" r="2.2" />
        <circle cx="168" cy="150" r="1.6" />
        <circle cx="205" cy="92" r="1.8" />
        <circle cx="300" cy="215" r="1.6" />
        <circle cx="140" cy="230" r="1.4" />
      </g>
      <path d="M70 195 H330 M200 60 V330" stroke="#2A1A3F" strokeWidth="10" />
      <rect x="70" y="60" width="260" height="270" rx="18" fill="none" stroke="#2A1A3F" strokeWidth="14" />
      <rect x="40" y="330" width="320" height="26" rx="8" fill="#6B3A5C" />
      <rect y="356" width="400" height="144" fill="#1E1229" />
      <rect width="400" height="500" fill={`url(#${id}-lamp)`} />
      <g fill="#0D0814">
        <path d="M235 336 C 205 336 196 300 204 268 C 210 244 224 232 240 230 C 256 232 270 244 276 268 C 284 300 275 336 245 336Z" />
        <path d="M276 324 C 320 328 334 300 318 280 C 312 272 304 276 308 284 C 316 300 300 314 274 310Z" />
        <circle cx="240" cy="214" r="34" />
        <path d="M212 200 L214 164 L238 188Z" />
        <path d="M268 200 L266 164 L242 188Z" />
      </g>
      <g fill="#FFD27A">
        <ellipse cx="228" cy="212" rx="5" ry="6.5" />
        <ellipse cx="252" cy="212" rx="5" ry="6.5" />
      </g>
      <g fill="#0D0814">
        <rect x="226.5" y="207" width="3" height="10" rx="1.5" />
        <rect x="250.5" y="207" width="3" height="10" rx="1.5" />
      </g>
      <g fill="#3DDC97" opacity="0.85">
        <path d="M96 330 C 90 300 100 276 112 262 C 112 290 108 310 104 330Z" />
        <path d="M108 330 C 116 296 134 282 150 276 C 138 296 126 314 118 330Z" />
        <path d="M100 330 C 80 306 68 296 58 292 C 66 306 80 320 92 330Z" />
      </g>
      <rect x="84" y="318" width="40" height="18" rx="5" fill="#C46A4E" />
    </>
  );
}

function ArtScene({ id }: SceneProps) {
  return (
    <>
      <defs>
        <linearGradient id={`${id}-wall`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1A1424" />
          <stop offset="1" stopColor="#2A1B33" />
        </linearGradient>
        <linearGradient id={`${id}-paint`} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#7C5CFF" />
          <stop offset="0.52" stopColor="#FF3D9A" />
          <stop offset="1" stopColor="#FFB443" />
        </linearGradient>
      </defs>
      <rect width="400" height="500" fill={`url(#${id}-wall)`} />
      <path d="M120 470 L170 120 M280 470 L230 120 M200 470 V380" stroke="#6B4A3A" strokeWidth="12" strokeLinecap="round" />
      <rect x="78" y="70" width="244" height="300" rx="10" fill="#F2E9DC" />
      <rect x="78" y="70" width="244" height="300" rx="10" fill="none" stroke="#C9B79E" strokeWidth="6" />
      <circle cx="250" cy="140" r="44" fill="#FFB443" opacity="0.9" />
      <path d="M96 300 C 140 220 190 250 210 200 C 230 150 280 190 306 160 V352 H96Z" fill="#7C5CFF" opacity="0.85" />
      <path d="M96 330 C 150 280 190 310 240 270 C 270 248 290 262 306 250 V352 H96Z" fill="#FF3D9A" opacity="0.9" />
      <path d="M110 120 C 140 100 170 140 150 170 C 130 200 100 170 110 120Z" fill="#3DDC97" opacity="0.85" />
      <path d="M120 250 C 170 236 200 270 260 238" fill="none" stroke="#1A1424" strokeWidth="6" strokeLinecap="round" opacity="0.7" />
      <rect x="60" y="370" width="280" height="14" rx="7" fill="#6B4A3A" />
      <g transform="rotate(-28 300 420)">
        <rect x="250" y="414" width="110" height="10" rx="5" fill="#E8D5B5" />
        <rect x="236" y="412" width="22" height="14" rx="3" fill="#B0B0C0" />
        <path d="M236 412 C 222 412 214 419 214 419 C 214 419 222 426 236 426Z" fill={`url(#${id}-paint)`} />
      </g>
      <g opacity="0.9">
        <circle cx="70" cy="440" r="12" fill="#FF3D9A" />
        <circle cx="98" cy="452" r="10" fill="#FFB443" />
        <circle cx="62" cy="470" r="9" fill="#7C5CFF" />
      </g>
    </>
  );
}

function Gaming({ id }: SceneProps) {
  return (
    <>
      <defs>
        <linearGradient id={`${id}-sky`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0B0620" />
          <stop offset="0.6" stopColor="#2A0F4D" />
          <stop offset="1" stopColor="#5A1C6E" />
        </linearGradient>
        <linearGradient id={`${id}-sun`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFB443" />
          <stop offset="1" stopColor="#FF3D9A" />
        </linearGradient>
        <linearGradient id={`${id}-pad`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2A2A3A" />
          <stop offset="1" stopColor="#15151F" />
        </linearGradient>
      </defs>
      <rect width="400" height="500" fill={`url(#${id}-sky)`} />
      <circle cx="200" cy="230" r="96" fill={`url(#${id}-sun)`} />
      <g fill="#2A0F4D">
        <rect x="100" y="236" width="200" height="8" />
        <rect x="100" y="258" width="200" height="11" />
        <rect x="100" y="282" width="200" height="14" />
        <rect x="100" y="308" width="200" height="18" />
      </g>
      <rect y="300" width="400" height="200" fill="#12061F" />
      <g stroke="#B04CFF" strokeWidth="2" opacity="0.75">
        <path d="M0 320 H400 M0 345 H400 M0 378 H400 M0 422 H400 M0 480 H400" />
        <path d="M200 300 L200 500 M160 300 L80 500 M240 300 L320 500 M120 300 L-40 500 M280 300 L440 500 M80 300 L-160 500 M320 300 L560 500" />
      </g>
      <g transform="translate(200 395)">
        <path
          d="M-92 -38 C -120 -38 -132 -10 -136 22 C -140 52 -128 70 -108 70 C -88 70 -78 44 -58 36 H58 C 78 44 88 70 108 70 C 128 70 140 52 136 22 C 132 -10 120 -38 92 -38Z"
          fill={`url(#${id}-pad)`}
          stroke="#7C5CFF"
          strokeWidth="3"
        />
        <path d="M-84 -6 H-56 M-70 -20 V8" stroke="#E6E6F0" strokeWidth="9" strokeLinecap="round" />
        <circle cx="62" cy="-14" r="8" fill="#FF3D9A" />
        <circle cx="82" cy="4" r="8" fill="#3DDC97" />
        <circle cx="42" cy="4" r="8" fill="#FFB443" />
        <circle cx="62" cy="22" r="8" fill="#38BDF8" />
        <circle cx="-30" cy="26" r="11" fill="#0B0B12" stroke="#2A2A3A" strokeWidth="3" />
        <circle cx="26" cy="26" r="11" fill="#0B0B12" stroke="#2A2A3A" strokeWidth="3" />
      </g>
      <g fill="#FFFFFF" opacity="0.8">
        <circle cx="60" cy="70" r="1.8" />
        <circle cx="330" cy="54" r="2.2" />
        <circle cx="290" cy="120" r="1.4" />
        <circle cx="110" cy="140" r="1.4" />
      </g>
    </>
  );
}

function Car({ id }: SceneProps) {
  return (
    <>
      <defs>
        <linearGradient id={`${id}-sky`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1B1440" />
          <stop offset="0.5" stopColor="#7C2C7A" />
          <stop offset="0.8" stopColor="#FF5C8A" />
          <stop offset="1" stopColor="#FFB443" />
        </linearGradient>
        <linearGradient id={`${id}-body`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FF3D9A" />
          <stop offset="1" stopColor="#8E1A57" />
        </linearGradient>
        <linearGradient id={`${id}-glass`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FFC56B" stopOpacity="0.9" />
          <stop offset="1" stopColor="#2B1247" stopOpacity="0.9" />
        </linearGradient>
      </defs>
      <rect width="400" height="500" fill={`url(#${id}-sky)`} />
      <circle cx="300" cy="290" r="54" fill="#FFE0A0" opacity="0.9" />
      <path d="M0 300 L60 270 L110 288 L170 252 L230 286 L290 262 L340 280 L400 266 V320 H0Z" fill="#3B1A52" />
      <rect y="316" width="400" height="184" fill="#1A1020" />
      <path d="M0 395 H400" stroke="#FFB443" strokeWidth="4" strokeDasharray="34 26" opacity="0.7" />
      <ellipse cx="200" cy="384" rx="168" ry="12" fill="#000000" opacity="0.45" />
      <g>
        <path
          d="M40 362 C 40 340 52 330 80 326 L130 320 C 150 296 180 282 222 282 C 262 282 288 296 306 318 L340 324 C 360 328 366 342 364 362Z"
          fill={`url(#${id}-body)`}
        />
        <path d="M148 320 C 164 302 186 292 218 292 L220 320Z" fill={`url(#${id}-glass)`} />
        <path d="M230 292 C 258 293 278 304 292 320 L230 320Z" fill={`url(#${id}-glass)`} />
        <path d="M44 344 H360" stroke="#FFFFFF" strokeOpacity="0.35" strokeWidth="2.5" />
        <rect x="344" y="334" width="18" height="7" rx="3.5" fill="#FFF1C2" />
        <rect x="40" y="336" width="14" height="7" rx="3.5" fill="#FF3D3D" />
        <circle cx="110" cy="364" r="27" fill="#0B0B12" />
        <circle cx="110" cy="364" r="12" fill="#9A9AB0" />
        <circle cx="294" cy="364" r="27" fill="#0B0B12" />
        <circle cx="294" cy="364" r="12" fill="#9A9AB0" />
      </g>
      <path d="M362 338 L400 322 V356Z" fill="#FFF1C2" opacity="0.25" />
    </>
  );
}

function Music({ id }: SceneProps) {
  return (
    <>
      <defs>
        <linearGradient id={`${id}-bg`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#120A2A" />
          <stop offset="1" stopColor="#3A1240" />
        </linearGradient>
        <linearGradient id={`${id}-sleeve`} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#7C5CFF" />
          <stop offset="0.52" stopColor="#FF3D9A" />
          <stop offset="1" stopColor="#FFB443" />
        </linearGradient>
      </defs>
      <rect width="400" height="500" fill={`url(#${id}-bg)`} />
      <circle cx="232" cy="200" r="120" fill="#0B0B12" />
      <g fill="none" stroke="#2A2A3A" strokeWidth="2">
        <circle cx="232" cy="200" r="104" />
        <circle cx="232" cy="200" r="88" />
        <circle cx="232" cy="200" r="72" />
        <circle cx="232" cy="200" r="58" />
      </g>
      <circle cx="232" cy="200" r="36" fill="#FFB443" />
      <circle cx="232" cy="200" r="5" fill="#0B0B12" />
      <path d="M152 140 A 100 100 0 0 1 196 104" fill="none" stroke="#FFFFFF" strokeOpacity="0.18" strokeWidth="6" strokeLinecap="round" />
      <rect x="50" y="80" width="190" height="240" rx="10" fill={`url(#${id}-sleeve)`} />
      <rect x="72" y="104" width="62" height="62" rx="31" fill="#FFFFFF" opacity="0.2" />
      <path d="M72 280 H200 M72 296 H160" stroke="#120A2A" strokeOpacity="0.55" strokeWidth="7" strokeLinecap="round" />
      <g>
        {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((bar) => {
          const height = [40, 70, 110, 80, 130, 95, 60, 120, 85, 50, 100, 65][bar];
          return (
            <rect
              key={bar}
              x={44 + bar * 27}
              y={470 - height}
              width="16"
              height={height}
              rx="8"
              fill={`url(#${id}-sleeve)`}
              opacity={0.55 + (bar % 3) * 0.15}
            />
          );
        })}
      </g>
      <g fill="#FFFFFF" opacity="0.85">
        <path d="M330 300 V250 L360 242 V292" stroke="#FFFFFF" strokeWidth="4" fill="none" />
        <ellipse cx="324" cy="302" rx="9" ry="7" />
        <ellipse cx="354" cy="294" rx="9" ry="7" />
      </g>
    </>
  );
}

const SCENES: Record<Art, (props: SceneProps) => React.ReactElement> = {
  nature: Nature,
  cat: Cat,
  art: ArtScene,
  gaming: Gaming,
  car: Car,
  music: Music,
};
