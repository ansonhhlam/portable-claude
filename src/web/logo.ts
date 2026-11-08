// The longcord mark: a cord with a single loop. Same geometry as
// scripts/gen-icons.mjs, drawn with currentColor.
import { svg } from './dom.js';

const LOOP_B = 3;
const SCALE = 4.2;

export function logoPath(steps = 64): string {
  const tailY = 32 + SCALE * LOOP_B;
  const pts: [number, number][] = [[8, tailY]];
  for (let i = 0; i <= steps; i++) {
    const t = -Math.PI + (2 * Math.PI * i) / steps;
    pts.push([32 + SCALE * (t - LOOP_B * Math.sin(t)), 32 - SCALE * LOOP_B * Math.cos(t)]);
  }
  pts.push([56, tailY]);
  return pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`).join(' ');
}

export function logoMark(size = 28): SVGElement {
  return svg(
    'svg',
    {
      viewBox: '4 12 56 40',
      width: Math.round(size * 1.4),
      height: size,
      class: 'logo-mark',
      'aria-hidden': 'true',
    },
    svg('path', {
      d: logoPath(),
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': 5,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
    }),
  );
}
