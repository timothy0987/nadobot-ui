import { utcDayStartSec, netPnlSince, decideBuyBlock, MAX_RISK_STALENESS_MS, type Fill } from '../src/trading/risk';

const fill = (timestamp: number, realizedPnl: number, fee: number): Fill => ({ submissionIdx: 1n, timestamp, realizedPnl, fee });

describe('utcDayStartSec', () => {
  it('snaps to 00:00 UTC regardless of local timezone', () => {
    expect(utcDayStartSec(Date.parse('2026-09-14T21:17:00Z'))).toBe(Date.parse('2026-09-14T00:00:00Z') / 1000);
    expect(utcDayStartSec(Date.parse('2026-09-15T00:00:00Z'))).toBe(Date.parse('2026-09-15T00:00:00Z') / 1000);
  });
});

describe('netPnlSince', () => {
  const day = Date.parse('2026-09-14T00:00:00Z') / 1000;

  it('reproduces the live testnet round trip: realized PnL minus fees', () => {
    // The test trader's actual fills; its USDT0 balance fell $0.3722 (the extra $0.0009 was funding).
    const fills = [
      fill(day + 72000, 0, 0.0512),
      fill(day + 72000, 0, 0.0042),
      fill(day + 72200, 0, 0.0553),
      fill(day + 72240, 0, 0.035),
      fill(day + 72300, -0.016, 0.0512),
      fill(day + 72300, -0.0714, 0.0871),
    ];
    expect(netPnlSince(fills, day)).toBeCloseTo(-0.3713, 3); // fees above are rounded to 4dp
  });

  it("ignores yesterday's fills", () => {
    expect(netPnlSince([fill(day - 1, -50, 1), fill(day + 10, 5, 0.5)], day)).toBeCloseTo(4.5, 6);
  });
});

describe('decideBuyBlock', () => {
  const ok = { tradingPaused: false, dailyLossLimitUsd: 25, dailyNetPnl: -3, lastCheckAgeMs: 1000 };

  it('allows buys while under the limit', () => {
    expect(decideBuyBlock(ok)).toBeNull();
  });

  it('kill switch blocks buys even when PnL is positive', () => {
    expect(decideBuyBlock({ ...ok, tradingPaused: true, dailyNetPnl: 100 })).toMatch(/Kill switch/);
  });

  it('blocks once the loss reaches the limit, not before', () => {
    expect(decideBuyBlock({ ...ok, dailyNetPnl: -24.99 })).toBeNull();
    expect(decideBuyBlock({ ...ok, dailyNetPnl: -25 })).toMatch(/Daily loss limit hit/);
  });

  it('fails closed when trade history could not be read recently', () => {
    expect(decideBuyBlock({ ...ok, dailyNetPnl: null, lastCheckAgeMs: null })).toMatch(/can't be verified/);
    expect(decideBuyBlock({ ...ok, lastCheckAgeMs: MAX_RISK_STALENESS_MS + 1 })).toMatch(/can't be verified/);
  });

  it('a limit of 0 disables the loss check (kill switch still applies)', () => {
    expect(decideBuyBlock({ ...ok, dailyLossLimitUsd: 0, dailyNetPnl: -1000, lastCheckAgeMs: null })).toBeNull();
    expect(decideBuyBlock({ ...ok, dailyLossLimitUsd: 0, tradingPaused: true })).toMatch(/Kill switch/);
  });
});
