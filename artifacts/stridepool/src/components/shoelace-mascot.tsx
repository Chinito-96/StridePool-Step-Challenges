import type { SVGProps } from 'react';

type ShoelaceMascotProps = SVGProps<SVGSVGElement> & {
  mood?: 'happy' | 'calm' | 'ready';
  size?: number;
  label?: string;
};

export function ShoelaceMascot({ mood = 'happy', size = 48, label, className = '', ...props }: ShoelaceMascotProps) {
  const mouth = mood === 'calm' ? 'M43 48c3 1.5 6 1.5 9 0' : mood === 'ready' ? 'M42 47c3 2.5 7 2.5 10 0' : 'M41 47c4 4 8 4 12 0';

  return (
    <svg
      {...props}
      className={`shoelace-mascot shoelace-whip ${className}`}
      width={size}
      height={size}
      viewBox="0 0 96 80"
      fill="none"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      <ellipse cx="48" cy="70" rx="25" ry="3.5" fill="currentColor" opacity=".12" />
      <g className="shoelace-bow" stroke="hsl(var(--accent))" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M48 52c-8-12-20-12-23-4 8 8 15 8 23 4Z" fill="hsl(var(--accent) / .32)" />
        <path d="M48 52c8-12 20-12 23-4-8 8-15 8-23 4Z" fill="hsl(var(--accent) / .32)" />
        <path d="M48 49v9" />
      </g>
      <g className="shoelace-lace" stroke="hsl(var(--primary))" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 23C9 37 18 59 38 63c19 4 39-8 40-27 1-9-4-15-10-14-7 1-7 9 0 12 9 4 17-2 19-11" />
        <path d="M22 23c8 7 15 9 23 8 8-1 13-6 18-13" />
      </g>
      <g className="shoelace-aglets" fill="hsl(var(--accent))" stroke="hsl(var(--foreground))" strokeWidth="2">
        <rect x="15" y="17" width="14" height="9" rx="4.5" transform="rotate(-30 15 17)" />
        <rect x="67" y="13" width="14" height="9" rx="4.5" transform="rotate(26 67 13)" />
      </g>
      <path d={mouth} stroke="hsl(var(--foreground))" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}