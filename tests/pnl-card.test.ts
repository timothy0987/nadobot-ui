import { describe, expect, it } from 'vitest';
import { pnlCardData, shareText, signedDollars, signedPercent } from '../src/lib/pnlCard';
import type { PositionRecord } from '../src/lib/nado';

const closed: PositionRecord = {
  productId: 2,
  isolated: false,
  long: true,
  open: false,
  openId: '1',
  size: 0,
  maxSize: 0.01,
  entryPrice: 70000,
  exitPrice: 73500,
  fees: 1.5,
  realizedPnl: 35,
  funding: -0.5,
  liquidatedSize: 0,
  openedAt: 1_790_000_000,
  updatedAt: 1_790_000_000 + 3 * 3600,
};

describe('PnL card', () => {
  it('shows the return net of fees and funding, against the entry value', () => {
    const d = pnlCardData(closed, 'BTC-PERP', (10n ** 18n).toString());
    expect(d.netPnl).toBeCloseTo(33, 9); // 35 - 1.5 fees - 0.5 funding
    expect(d.returnPercent).toBeCloseTo((33 / 700) * 100, 9); // entry value 70,000 x 0.01
    expect(d).toMatchObject({ symbol: 'BTC-PERP', side: 'Long', entry: '$70,000', exit: '$73,500', held: '3h' });
  });

  it('handles shorts, losses and short holds', () => {
    const d = pnlCardData({ ...closed, long: false, realizedPnl: -20, updatedAt: closed.openedAt + 90 }, 'ETH-PERP');
    expect(d.side).toBe('Short');
    expect(d.returnPercent).toBeLessThan(0);
    expect(d.held).toBe('2m');
  });

  it('never divides by zero', () => {
    expect(pnlCardData({ ...closed, maxSize: 0 }, 'BTC-PERP').returnPercent).toBe(0);
  });

  it('formats signs the way traders read them', () => {
    expect(signedPercent(4.714)).toBe('+4.71%');
    expect(signedPercent(-2.5)).toBe('−2.50%');
    expect(signedPercent(0)).toBe('0.00%');
    expect(signedDollars(1234.5)).toBe('+$1,234.50');
    expect(signedDollars(-3)).toBe('−$3.00');
  });

  it('writes a post that credits Nado and Nadobot without dollar amounts', () => {
    const text = shareText(pnlCardData(closed, 'BTC-PERP'));
    expect(text).toBe('Closed a long on BTC-PERP: +4.71% net, automated on Nado with Nadobot.');
    expect(text).not.toMatch(/\$/);
  });
});
