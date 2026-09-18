import type { SVGProps } from 'react';

type ShoelaceMascotProps = SVGProps<SVGSVGElement> & {
  mood?: 'happy' | 'calm' | 'ready';
  size?: number;
  label?: string;
};

export function ShoelaceMascot({ mood = 'happy', size = 48, label, className = '', ...props }: ShoelaceMascotProps) {
  const trailOpacity = mood === 'calm' ? 0.42 : mood === 'ready' ? 0.9 : 0.68;

  return (
    <svg
      {...props}
      className={`shoelace-mascot shoelace-whip ${className}`}
      width={size}
      height={size}
      viewBox="0 0 128 128"
      fill="none"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      <ellipse cx="65" cy="111" rx="42" ry="4" fill="currentColor" opacity=".12" />
      <g className="shoelace-step-mark" transform="rotate(-13 64 64)" stroke="currentColor" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M58 61c-7-8-20-10-29-4-10 7-7 17 5 21l13 4c12 4 13 14 2 20-15 8-32 1-37-10" />
        <path d="M77 83V25h21c14 0 23 8 23 19s-9 19-23 19H77" />
      </g>
      <g className="shoelace-motion" stroke="hsl(var(--accent))" strokeWidth="5" strokeLinecap="round">
        <path d="M58 72 78 52" />
        <path d="M7 76 22 71" opacity={trailOpacity} />
        <path d="M4 89 20 85" opacity={trailOpacity * .76} />
        <path d="M7 102 21 99" opacity={trailOpacity * .52} />
        <circle cx="78" cy="52" r="3.5" fill="hsl(var(--accent))" stroke="none" />
      </g>
    </svg>
  );
}