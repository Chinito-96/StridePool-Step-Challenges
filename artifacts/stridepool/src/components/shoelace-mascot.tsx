import type { ImgHTMLAttributes } from 'react';

type ShoelaceMascotProps = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'alt' | 'width' | 'height'> & {
  mood?: 'happy' | 'calm' | 'ready';
  size?: number;
  label?: string;
};

export function ShoelaceMascot({ mood: _mood = 'happy', size = 48, label, className = '', ...props }: ShoelaceMascotProps) {
  return (
    <img
      {...props}
      className={`stridepool-mark ${className}`}
      src="/icons/stridepool-mark-1024.png"
      width={size}
      height={size}
      alt={label ?? ''}
      aria-hidden={label ? undefined : true}
      draggable={false}
    />
  );
}