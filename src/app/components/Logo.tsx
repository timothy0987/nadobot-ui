import { useId } from 'react';
import { LOGO_GEOMETRY as g, LOGO_GRADIENT } from '@/lib/logo';

/** The Nadobot mark as inline SVG. Decorative by default, since it sits next to the "Nadobot" wordmark. */
export function Logo({ size = 32, title }: { size?: number; title?: string }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role={title ? 'img' : undefined} aria-hidden={title ? undefined : true} className="logo-mark">
      {title && <title>{title}</title>}
      <defs>
        <linearGradient id={`${id}-fill`} x1="6" y1="4" x2="58" y2="62" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={LOGO_GRADIENT[0]} />
          <stop offset="1" stopColor={LOGO_GRADIENT[1]} />
        </linearGradient>
        <linearGradient id={`${id}-shine`} x1="0" y1="0" x2="0" y2="64" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#fff" stopOpacity=".2" />
          <stop offset=".55" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx={g.tileRadius} fill={`url(#${id}-fill)`} />
      <rect width="64" height="64" rx={g.tileRadius} fill={`url(#${id}-shine)`} />
      <path
        d={g.wicks.map(([x, y1, y2]) => `M${x} ${y1}V${y2}`).join('')}
        stroke="#fff"
        strokeWidth={g.wickWidth}
        strokeLinecap="round"
        strokeOpacity={0.6}
      />
      {g.bodies.map(([x, y, w, h]) => (
        <rect key={x} x={x} y={y} width={w} height={h} rx={g.bodyRadius} fill="#fff" />
      ))}
      <path
        d={`M${g.diagonal[0]} ${g.diagonal[1]}L${g.diagonal[2]} ${g.diagonal[3]}`}
        stroke="#fff"
        strokeWidth={g.diagonalWidth}
        strokeLinecap="round"
      />
    </svg>
  );
}
