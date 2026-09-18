/**
 * The Nadobot mark: an "N" drawn as two candlesticks, the second set higher (a market moving up), joined by the
 * diagonal. Geometry is on a 64x64 grid, shared by the header logo, the PnL share card and the generated icons
 * (scripts/generate-icons.mjs), so every copy stays identical.
 */

export const LOGO_GRADIENT = ['#3b82f6', '#10b981'] as const;

export const LOGO_GEOMETRY = {
  /** Candle wicks: [x, top, bottom]. */
  wicks: [
    [20, 17, 55],
    [44, 9, 47],
  ],
  /** Candle bodies: [x, y, width, height]. */
  bodies: [
    [14.5, 23, 11, 26],
    [38.5, 15, 11, 26],
  ],
  bodyRadius: 3,
  /** The N's diagonal: [x1, y1, x2, y2]. */
  diagonal: [24.5, 26.5, 39.5, 37.5],
  wickWidth: 2.5,
  diagonalWidth: 6.5,
  tileRadius: 16,
} as const;

/** The white glyph on its own, for placing on any background. */
export function logoGlyphSvg(opts: { wickOpacity?: number } = {}): string {
  const g = LOGO_GEOMETRY;
  const wicks = g.wicks.map(([x, y1, y2]) => `M${x} ${y1}V${y2}`).join('');
  return [
    `<path d="${wicks}" stroke="#fff" stroke-width="${g.wickWidth}" stroke-linecap="round" stroke-opacity="${opts.wickOpacity ?? 0.6}"/>`,
    ...g.bodies.map(([x, y, w, h]) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${g.bodyRadius}" fill="#fff"/>`),
    `<path d="M${g.diagonal[0]} ${g.diagonal[1]}L${g.diagonal[2]} ${g.diagonal[3]}" stroke="#fff" stroke-width="${g.diagonalWidth}" stroke-linecap="round"/>`,
  ].join('');
}

/**
 * The full mark as a standalone SVG document. `rounded: false` fills the square edge to edge (for platforms that apply
 * their own mask, like iOS and Android adaptive icons); `scale` shrinks the glyph toward the centre for mask safe zones.
 */
export function logoSvg(opts: { size?: number; rounded?: boolean; scale?: number } = {}): string {
  const { size = 64, rounded = true, scale = 1 } = opts;
  const r = rounded ? LOGO_GEOMETRY.tileRadius : 0;
  const offset = (64 - 64 * scale) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64">
<defs>
<linearGradient id="nb-fill" x1="6" y1="4" x2="58" y2="62" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${LOGO_GRADIENT[0]}"/><stop offset="1" stop-color="${LOGO_GRADIENT[1]}"/></linearGradient>
<linearGradient id="nb-shine" x1="0" y1="0" x2="0" y2="64" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff" stop-opacity=".2"/><stop offset=".55" stop-color="#fff" stop-opacity="0"/></linearGradient>
</defs>
<rect width="64" height="64" rx="${r}" fill="url(#nb-fill)"/>
<rect width="64" height="64" rx="${r}" fill="url(#nb-shine)"/>
<g transform="translate(${offset} ${offset}) scale(${scale})">${logoGlyphSvg()}</g>
</svg>
`;
}

/** Draws the mark on a canvas at (x, y), `size` pixels square. */
export function drawLogo(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
  const g = LOGO_GEOMETRY;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 64, size / 64);

  const tile = () => {
    ctx.beginPath();
    ctx.roundRect(0, 0, 64, 64, g.tileRadius);
  };
  const fill = ctx.createLinearGradient(6, 4, 58, 62);
  fill.addColorStop(0, LOGO_GRADIENT[0]);
  fill.addColorStop(1, LOGO_GRADIENT[1]);
  tile();
  ctx.fillStyle = fill;
  ctx.fill();
  const shine = ctx.createLinearGradient(0, 0, 0, 64);
  shine.addColorStop(0, 'rgba(255,255,255,0.2)');
  shine.addColorStop(0.55, 'rgba(255,255,255,0)');
  tile();
  ctx.fillStyle = shine;
  ctx.fill();

  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.lineWidth = g.wickWidth;
  ctx.beginPath();
  for (const [wx, y1, y2] of g.wicks) {
    ctx.moveTo(wx, y1);
    ctx.lineTo(wx, y2);
  }
  ctx.stroke();

  ctx.fillStyle = '#fff';
  for (const [bx, by, w, h] of g.bodies) {
    ctx.beginPath();
    ctx.roundRect(bx, by, w, h, g.bodyRadius);
    ctx.fill();
  }

  ctx.strokeStyle = '#fff';
  ctx.lineWidth = g.diagonalWidth;
  ctx.beginPath();
  ctx.moveTo(g.diagonal[0], g.diagonal[1]);
  ctx.lineTo(g.diagonal[2], g.diagonal[3]);
  ctx.stroke();
  ctx.restore();
}
