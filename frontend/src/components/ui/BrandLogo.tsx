import type { CSSProperties } from 'react';
import { APP_LOGO, APP_NAME } from '@/lib/brand';

/** The same original mark on every branded surface. */
export default function BrandLogo({ size, decorative = false, className, style }: {
  size: number;
  decorative?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  return <img src={APP_LOGO} alt={decorative ? '' : APP_NAME}
    aria-hidden={decorative || undefined} width={size} height={size}
    className={className} style={{ width: size, height: size, objectFit: 'contain', ...style }} />;
}
