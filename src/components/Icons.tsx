import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

function base(props: IconProps) {
  return {
    width: 22,
    height: 22,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    ...props,
  };
}

export function HomeIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M3.5 10.5 12 3.5l8.5 7" />
      <path d="M5.5 9.5V20h13V9.5" />
      <path d="M9.5 20v-5.5h5V20" />
    </svg>
  );
}

export function CompassIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m15 9-1.8 4.2L9 15l1.8-4.2z" />
    </svg>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function TrophyIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M7 4h10v5a5 5 0 0 1-10 0z" />
      <path d="M7 5H4.5v1.5A3.5 3.5 0 0 0 8 10M17 5h2.5v1.5A3.5 3.5 0 0 1 16 10" />
      <path d="M12 14v3M9 20h6M10 17h4" />
    </svg>
  );
}

export function UserIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="8.5" r="3.6" />
      <path d="M4.8 20c.9-3.6 3.7-5.6 7.2-5.6s6.3 2 7.2 5.6" />
    </svg>
  );
}

export function HeartIcon({ filled, ...props }: IconProps & { filled?: boolean }) {
  return (
    <svg {...base(props)} fill={filled ? 'currentColor' : 'none'}>
      <path d="M12 20s-7.3-4.4-7.3-9.3A4.2 4.2 0 0 1 12 8a4.2 4.2 0 0 1 7.3 2.7C19.3 15.6 12 20 12 20Z" />
    </svg>
  );
}

export function CommentIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M20 12.5c0 3.6-3.6 6.5-8 6.5a9.6 9.6 0 0 1-2.6-.35L5 20l1.2-3A6.3 6.3 0 0 1 4 12.5C4 8.9 7.6 6 12 6s8 2.9 8 6.5Z" />
    </svg>
  );
}

export function ShareIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 16V4" />
      <path d="m8 7.5 4-3.5 4 3.5" />
      <path d="M5 13v5.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V13" />
    </svg>
  );
}

export function BellIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M18 16V11a6 6 0 1 0-12 0v5l-1.5 2.5h15z" />
      <path d="M10 20.5a2.2 2.2 0 0 0 4 0" />
    </svg>
  );
}

export function MailIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="M3.5 7.5 12 13l8.5-5.5" />
    </svg>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" />
    </svg>
  );
}

export function SparkIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 3.5 13.9 9l5.6 1.9-5.6 1.9L12 18.5l-1.9-5.7L4.5 11 10.1 9z" />
    </svg>
  );
}

export function FlagIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M6 20V4.5h11l-2 3.5 2 3.5H6" />
    </svg>
  );
}

export function ShieldIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 3.5 19 6v5.5c0 4-2.9 7.3-7 8.9-4.1-1.6-7-4.9-7-8.9V6z" />
      <path d="m9.2 12 2 2 3.6-3.8" />
    </svg>
  );
}

export function ChartIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 20h16" />
      <path d="M7 20v-6M12 20V7M17 20v-9" />
    </svg>
  );
}

export function EyeIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M3 12s3.4-5.5 9-5.5S21 12 21 12s-3.4 5.5-9 5.5S3 12 3 12Z" />
      <circle cx="12" cy="12" r="2.4" />
    </svg>
  );
}

export function ArrowIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </svg>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m5 12.5 4.5 4.5L19 7" />
    </svg>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M6 6 18 18M18 6 6 18" />
    </svg>
  );
}

export function ImageIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="3.5" y="5" width="17" height="14" rx="3" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="m4.5 17 4.2-4 3.3 3 2.8-2.4 4.7 4.2" />
    </svg>
  );
}

export function FireIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 3.5s4.5 3.6 4.5 7.6c0 1.4-.6 2.5-1.5 3.2.2-1.7-.6-3.3-2-4.3.2 2.2-1 3.3-2 4.2-1 .9-1.5 1.9-1.5 3 0 1.7 1.6 3.3 4 3.3s4.5-1.8 4.5-4.4" />
      <path d="M12 3.5C9 6 7.5 8.4 7.5 11.1c0 1.2.3 2.2.9 3" />
    </svg>
  );
}

export function VideoIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="2.5" y="6" width="13" height="12" rx="3" />
      <path d="m15.5 10.5 5-2.5v8l-5-2.5z" />
    </svg>
  );
}

export function RecordIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function StopIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="6.5" y="6.5" width="11" height="11" rx="2.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function PlayIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M8.5 5.8v12.4l10-6.2z" fill="currentColor" />
    </svg>
  );
}

export function PauseIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="7.5" y="6" width="3.5" height="12" rx="1.2" fill="currentColor" stroke="none" />
      <rect x="13" y="6" width="3.5" height="12" rx="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function TrimIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="6.5" cy="17.5" r="2.5" />
      <circle cx="17.5" cy="17.5" r="2.5" />
      <path d="M8.3 15.7 18 4M15.7 15.7 6 4" />
    </svg>
  );
}

export function CropIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M6.5 2.5v15h15" />
      <path d="M2.5 6.5h15v15" />
    </svg>
  );
}

export function RotateIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M20 11.5a8 8 0 1 0-2.4 5.7" />
      <path d="M20 5.5v6h-6" />
    </svg>
  );
}

export function VolumeIcon({ muted, ...props }: IconProps & { muted?: boolean }) {
  return (
    <svg {...base(props)}>
      <path d="M4.5 9.5h3l4-3.5v12l-4-3.5h-3z" />
      {muted ? (
        <path d="m15.5 9.5 4 5m0-5-4 5" />
      ) : (
        <path d="M15 9.2a4 4 0 0 1 0 5.6M17.6 7a7.5 7.5 0 0 1 0 10" />
      )}
    </svg>
  );
}

export function TrashIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4.5 6.5h15" />
      <path d="M9 6.5V4.8c0-.7.6-1.3 1.3-1.3h3.4c.7 0 1.3.6 1.3 1.3v1.7" />
      <path d="M6.5 6.5 7.4 19a1.5 1.5 0 0 0 1.5 1.4h6.2a1.5 1.5 0 0 0 1.5-1.4l.9-12.5" />
    </svg>
  );
}

export function ChevronIcon({ direction = 'right', ...props }: IconProps & { direction?: 'left' | 'right' }) {
  return (
    <svg {...base(props)}>
      <path d={direction === 'left' ? 'M14.5 5.5 8 12l6.5 6.5' : 'M9.5 5.5 16 12l-6.5 6.5'} />
    </svg>
  );
}

export function SwitchCameraIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="2.5" y="6" width="19" height="13" rx="3" />
      <path d="M8.5 12.5a3.5 3.5 0 0 1 6-2.4M15.5 11.5a3.5 3.5 0 0 1-6 2.4" />
      <path d="M14.8 8.6h2v2M9.2 16.4h-2v-2" />
    </svg>
  );
}
