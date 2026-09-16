import { formatPrice, positionNetPnl, type PositionRecord } from './nado';

export interface PnlCardData {
  symbol: string;
  side: 'Long' | 'Short';
  /** Net result (after fees and funding) as a share of the largest position's entry value. */
  returnPercent: number;
  netPnl: number;
  entry: string;
  exit: string;
  held: string;
  closedOn: string;
}

function heldFor(seconds: number) {
  if (seconds < 3600) return `${Math.max(Math.round(seconds / 60), 1)}m`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86400)}d`;
}

/** Pure: what a card shows for a closed position. The return is net of fees and funding, so it can't flatter. */
export function pnlCardData(p: PositionRecord, symbol: string, priceIncrementX18?: string): PnlCardData {
  const net = positionNetPnl(p);
  const entryValue = p.entryPrice * p.maxSize;
  return {
    symbol,
    side: p.long ? 'Long' : 'Short',
    returnPercent: entryValue > 0 ? (net / entryValue) * 100 : 0,
    netPnl: net,
    entry: formatPrice(p.entryPrice, priceIncrementX18),
    exit: formatPrice(p.exitPrice, priceIncrementX18),
    held: heldFor(Math.max(p.updatedAt - p.openedAt, 0)),
    closedOn: new Date(p.updatedAt * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
  };
}

export const signedPercent = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(2)}%`;
export const signedDollars = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 630;

/**
 * Draws the card at 1200x630 (the size X, Telegram and others preview best). Dollar amounts are optional so a trader can
 * share a result without revealing their size.
 */
export function drawPnlCard(ctx: CanvasRenderingContext2D, d: PnlCardData, opts: { showDollars: boolean; site: string }) {
  const W = CARD_WIDTH;
  const H = CARD_HEIGHT;
  const font = (weight: number, size: number) => `${weight} ${size}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  const up = d.returnPercent >= 0;
  const accent = up ? '#10b981' : '#ef4444';

  // Background with a soft glow in the result's colour.
  ctx.fillStyle = '#0f1115';
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W * 0.8, H * 0.2, 0, W * 0.8, H * 0.2, W * 0.7);
  glow.addColorStop(0, up ? 'rgba(16,185,129,0.22)' : 'rgba(239,68,68,0.22)');
  glow.addColorStop(1, 'rgba(15,17,21,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // Brand
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#ffffff';
  ctx.font = font(800, 40);
  ctx.fillText('Nadobot', 72, 100);
  const brandWidth = ctx.measureText('Nadobot').width;
  ctx.font = font(600, 22);
  const pill = 'Built on Nado';
  const pillWidth = ctx.measureText(pill).width + 28;
  ctx.fillStyle = 'rgba(255,255,255,0.1)';
  roundRect(ctx, 72 + brandWidth + 18, 70, pillWidth, 40, 20);
  ctx.fill();
  ctx.fillStyle = '#9ca3af';
  ctx.fillText(pill, 72 + brandWidth + 32, 98);

  // Market and side
  ctx.fillStyle = '#ffffff';
  ctx.font = font(700, 52);
  ctx.fillText(d.symbol, 72, 210);
  const symbolWidth = ctx.measureText(d.symbol).width;
  ctx.font = font(700, 26);
  const sideWidth = ctx.measureText(d.side).width + 36;
  ctx.fillStyle = d.side === 'Long' ? 'rgba(16,185,129,0.18)' : 'rgba(239,68,68,0.18)';
  roundRect(ctx, 72 + symbolWidth + 24, 170, sideWidth, 50, 12);
  ctx.fill();
  ctx.fillStyle = d.side === 'Long' ? '#10b981' : '#ef4444';
  ctx.fillText(d.side, 72 + symbolWidth + 42, 205);

  // The result
  ctx.fillStyle = accent;
  ctx.font = font(800, 150);
  ctx.fillText(signedPercent(d.returnPercent), 64, 380);
  if (opts.showDollars) {
    ctx.font = font(600, 40);
    ctx.fillStyle = '#d1d5db';
    ctx.fillText(`${signedDollars(d.netPnl)} net of fees and funding`, 72, 440);
  } else {
    ctx.font = font(500, 28);
    ctx.fillStyle = '#9ca3af';
    ctx.fillText('Net of fees and funding', 72, 432);
  }

  // Details
  const details: [string, string][] = [
    ['Entry', d.entry],
    ['Exit', d.exit],
    ['Held', d.held],
    ['Closed', d.closedOn],
  ];
  details.forEach(([label, value], i) => {
    const x = 72 + i * 270;
    ctx.fillStyle = '#9ca3af';
    ctx.font = font(500, 22);
    ctx.fillText(label, x, 515);
    ctx.fillStyle = '#ffffff';
    ctx.font = font(700, 32);
    ctx.fillText(value, x, 556);
  });

  // Footer
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fillRect(0, H - 44, W, 44);
  ctx.fillStyle = '#9ca3af';
  ctx.font = font(500, 20);
  ctx.fillText('Automated trading on Nado, signed by your own wallet', 72, H - 15);
  ctx.textAlign = 'right';
  ctx.fillStyle = '#ffffff';
  ctx.font = font(700, 20);
  ctx.fillText(opts.site, W - 72, H - 15);
  ctx.textAlign = 'left';
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Text for a social post; the image carries the numbers. */
export function shareText(d: PnlCardData) {
  const verb = d.returnPercent >= 0 ? 'Closed' : 'Closed out';
  return `${verb} a ${d.side.toLowerCase()} on ${d.symbol}: ${signedPercent(d.returnPercent)} net, automated on Nado with Nadobot.`;
}
