import type { IconProps } from './types';

export function HomeIcon({ size = 24, color = 'currentColor', className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M3 9.5L12 3l9 6.5" />
      <path d="M19 13v6a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-6" />
    </svg>
  );
}

export function HomeActiveIcon({ size = 24, color = 'currentColor', className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={color}
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M3 9.5L12 3l9 6.5" />
      <path d="M19 13v6a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-6" />
    </svg>
  );
}
