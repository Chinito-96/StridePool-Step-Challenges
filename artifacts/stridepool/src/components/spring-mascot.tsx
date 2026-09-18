import type { SVGProps } from 'react';

type SpringMascotProps = SVGProps<SVGSVGElement> & {
  mood?: 'happy' | 'calm' | 'ready';
  size?: number;
  label?: string;
};

export function SpringMascot({ mood = 'happy', size = 48, label, className = '', ...props }: SpringMascotProps) {
  const face = mood === 'calm' ? 'M37 43c2 1 4 1 6 0' : mood === 'ready' ? 'M37 42c2 2 4 2 6 0' : 'M36 42c2.5 3 5.5 3 8 0';
  return (
    <svg
      {...props}
      className={`spring-mascot spring-bounce ${className}`}
      width={size}
      height={size}
      viewBox="0 0 80 80"
      fill="none"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      <ellipse cx="40" cy="70" rx="18" ry="3.5" fill="currentColor" opacity=".12" />
      <path d="M29 66c-1 4-3 6-6 7M51 66c1 4 3 6 6 7" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
      <path d="M40 10c-11 0-17 6-17 14 0 5 3 8 7 10-4 2-7 5-7 10 0 8 7 14 17 14s17-6 17-14c0-5-3-8-7-10 4-2 7-5 7-10 0-8-6-14-17-14Z" fill="hsl(var(--primary))" stroke="currentColor" strokeWidth="3.5" />
      <path d="M29 23c6 4 16 4 22 0M29 35c6 4 16 4 22 0M29 47c6 4 16 4 22 0" stroke="hsl(var(--primary-foreground))" strokeWidth="3" strokeLinecap="round" opacity=".92" />
      <circle cx="35" cy="39" r="2.5" fill="hsl(var(--foreground))" />
      <circle cx="46" cy="39" r="2.5" fill="hsl(var(--foreground))" />
      <path d={face} stroke="hsl(var(--foreground))" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="24" cy="38" r="3" fill="hsl(var(--accent))" opacity=".9" />
      <circle cx="56" cy="38" r="3" fill="hsl(var(--accent))" opacity=".9" />
    </svg>
  );
}