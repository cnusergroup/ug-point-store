import type { IconProps } from './types';

export function CartIcon({ size = 24, color = 'currentColor', className }: IconProps) {
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
      <circle cx="9" cy="20" r="1.5" />
      <circle cx="18" cy="20" r="1.5" />
      <path d="M1 1h4l2.68 13.39a1 1 0 0 0 1 .81h9.72a1 1 0 0 0 1-.76L21 7H6" />
    </svg>
  );
}

export function CartActiveIcon({ size = 24, color = 'currentColor', className }: IconProps) {
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
      <circle cx="9" cy="20" r="1.5" />
      <circle cx="18" cy="20" r="1.5" />
      <path d="M1 1h4l2.68 13.39a1 1 0 0 0 1 .81h9.72a1 1 0 0 0 1-.76L21 7H6" />
    </svg>
  );
}
