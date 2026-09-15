import { describe, expect, it } from 'vitest';
import { fromX18, planLadder, planTwap, priceTradePlan, TWAP_MAX_DURATION_SECONDS, type LadderInput, type TwapInput } from '../src/lib/nado';

// BTC-PERP market parameters on Nado: $1 tick, 0.00005 BTC lots, $100 minimum order.
const BTC = { priceIncrementX18: 10n ** 18n, sizeIncrementX18: 5n * 10n ** 13n, minOrderValueX18: 100n * 10n ** 18n };
const SENDER = `0x${'00'.repeat(32)}` as const;
const n = (x: bigint) => fromX18(x);
// Prices compared as exact x18 integers: converting to a JS number for display can add float noise (81138.00000000001).
const usd18 = (dollars: number) => BigInt(dollars) * 10n ** 18n;

describe('trade plan pricing', () => {
  const base = { productId: 2, sender: SENDER, stopLossPercent: 5, takeProfitPercent: 10, expiresInDays: 7, ...BTC };

  it('rounds a long entry down, sizes to whole lots and places exits either side', () => {
    const p = priceTradePlan({ ...base, side: 'long', size: 0.00337, entryPrice: 73761.7 });
    expect(p.amount).toBe(3_350_000_000_000_000n); // 0.00335 BTC
    expect(p.entryX18).toBe(usd18(73761)); // a buy never pays more than asked
    expect(p.stopX18).toBe(usd18(70074)); // 5% below
    expect(p.takeProfitX18).toBe(usd18(81138)); // 10% above
    // Exit limits allow 0.5% slippage past the trigger, in the direction of the exit.
    expect(n(p.stopLimitX18)).toBeLessThan(n(p.stopX18));
    expect(n(p.stopLimitX18)).toBeCloseTo(70073.615 * 0.995, -1);
    expect(n(p.takeProfitLimitX18)).toBeLessThan(n(p.takeProfitX18));
  });

  it('mirrors everything for a short', () => {
    const p = priceTradePlan({ ...base, side: 'short', size: 0.01, entryPrice: 76000.4 });
    expect(p.amount).toBe(-(10n ** 16n));
    expect(p.entryX18).toBe(usd18(76001)); // a sell never receives less than asked
    expect(n(p.stopX18)).toBeGreaterThan(76000.4);
    expect(n(p.takeProfitX18)).toBeLessThan(76000.4);
    expect(n(p.stopLimitX18)).toBeGreaterThan(n(p.stopX18));
    expect(n(p.takeProfitLimitX18)).toBeGreaterThan(n(p.takeProfitX18));
  });

  it('gives a zero amount below one lot', () => {
    expect(priceTradePlan({ ...base, side: 'long', size: 0.00001, entryPrice: 70000 }).amount).toBe(0n);
  });
});

describe('ladder planning', () => {
  const base: LadderInput = {
    productId: 2,
    sender: SENDER,
    side: 'long',
    totalSize: 0.01,
    rungs: 4,
    nearPrice: 75000,
    farPrice: 72000,
    distribution: 'even',
    stopLossPercent: 5,
    takeProfits: [
      { percent: 3, sharePercent: 50 },
      { percent: 6, sharePercent: 30 },
      { percent: 10, sharePercent: 20 },
    ],
    expiresInDays: 7,
    bid: 76000,
    ask: 76001,
    ...BTC,
  };
  const sum = (xs: bigint[]) => xs.reduce((a, b) => a + b, 0n);

  it('spreads an even long ladder across evenly spaced prices', () => {
    const plan = planLadder(base);
    expect(plan.errors).toEqual([]);
    expect(plan.rungs.map((r) => [n(r.amount), n(r.priceX18)])).toEqual([
      [0.0025, 75000],
      [0.0025, 74000],
      [0.0025, 73000],
      [0.0025, 72000],
    ]);
    expect(plan.averageEntry).toBeCloseTo(73500, 6);
    expect(plan.stop.triggerX18).toBe(usd18(69825));
    expect(plan.takeProfits.map((t) => [n(t.amount), n(t.triggerX18)])).toEqual([
      [-0.005, 75705],
      [-0.003, 77910],
      [-0.002, 80850],
    ]);
    expect(plan.signatures).toBe(8);
  });

  it('always places exactly the full size: entries, stop and targets all add up', () => {
    for (const input of [base, { ...base, totalSize: 0.01337, rungs: 7 }, { ...base, distribution: 'weighted' as const, totalSize: 0.05 }]) {
      const plan = planLadder(input);
      expect(sum(plan.rungs.map((r) => r.amount))).toBe(plan.amount);
      expect(plan.stop.amount).toBe(-plan.amount);
      expect(sum(plan.takeProfits.map((t) => t.amount))).toBe(-plan.amount);
      for (const r of plan.rungs) expect(r.amount % BTC.sizeIncrementX18).toBe(0n);
    }
  });

  it('puts more size on better prices when weighted', () => {
    const plan = planLadder({ ...base, distribution: 'weighted', totalSize: 0.02 });
    const sizes = plan.rungs.map((r) => n(r.amount));
    expect(sizes).toEqual([0.002, 0.004, 0.006, 0.008]);
  });

  it('mirrors a short ladder upward with exits below', () => {
    const plan = planLadder({ ...base, side: 'short', nearPrice: 77000, farPrice: 80000 });
    expect(plan.errors).toEqual([]);
    expect(plan.rungs.map((r) => r.priceX18)).toEqual([77000, 78000, 79000, 80000].map(usd18));
    expect(plan.rungs.every((r) => r.amount < 0n)).toBe(true);
    expect(plan.stop.triggerX18).toBe(usd18(82425));
    expect(plan.takeProfits.map((t) => t.triggerX18)).toEqual([76145, 73790, 70650].map(usd18));
  });

  it('supports a single entry', () => {
    const plan = planLadder({ ...base, rungs: 1, farPrice: 0 });
    expect(plan.errors).toEqual([]);
    expect(plan.rungs).toHaveLength(1);
    expect(plan.signatures).toBe(5);
  });

  it('rejects entries below the market minimum and says how much is needed', () => {
    const plan = planLadder({ ...base, distribution: 'weighted' });
    expect(plan.errors[0]).toMatch(/smallest rung is worth about \$75.*Use at least ~\$993/);
  });

  it('rejects a stop-loss that could fire before the ladder fills', () => {
    expect(planLadder({ ...base, stopLossPercent: 1 }).errors.join()).toMatch(/stop-loss .* at or above your last rung/);
  });

  it('rejects a take-profit at or below the first entry', () => {
    expect(planLadder({ ...base, takeProfits: [{ percent: 1, sharePercent: 100 }] }).errors.join()).toMatch(/could close at a loss/);
  });

  it('rejects a take-profit step too small to execute', () => {
    const plan = planLadder({ ...base, takeProfits: [{ percent: 3, sharePercent: 90 }, { percent: 6, sharePercent: 10 }] });
    expect(plan.errors.join()).toMatch(/Take-profit 2 closes only about .* below this market's \$100 minimum/);
  });

  it('requires increasing targets whose shares add up to 100%', () => {
    const errors = planLadder({ ...base, takeProfits: [{ percent: 6, sharePercent: 50 }, { percent: 3, sharePercent: 30 }] }).errors;
    expect(errors).toContain('Each take-profit must be further away than the one before it.');
    expect(errors.join()).toMatch(/add up to 80%/);
  });

  it('refuses entries that would fill immediately', () => {
    expect(planLadder({ ...base, nearPrice: 76500 }).errors.join()).toMatch(/at or above the ask/);
    expect(planLadder({ ...base, side: 'short', nearPrice: 75900, farPrice: 80000 }).errors.join()).toMatch(/at or below the bid/);
  });

  it('refuses ladders pointing the wrong way or tighter than the tick', () => {
    expect(planLadder({ ...base, farPrice: 76000 }).errors).toContain('For a long ladder, the last rung must be below the first.');
    expect(planLadder({ ...base, farPrice: 74997, rungs: 10, totalSize: 0.02 }).errors.join()).toMatch(/closer together than this market's price tick/);
  });

  it('asks for prices and size on an empty form without spurious errors', () => {
    const errors = planLadder({ ...base, nearPrice: 0, farPrice: 0, totalSize: 0 }).errors;
    expect(errors).toContain('Enter the price of the first rung.');
    expect(errors.join()).toMatch(/minimum lot size/);
    expect(errors.join()).not.toMatch(/price tick/);
  });
});

describe('TWAP planning', () => {
  const now = 1_790_000_000;
  const base: TwapInput = {
    productId: 2,
    sender: SENDER,
    side: 'buy',
    totalSize: 0.003,
    executions: 2,
    intervalSeconds: 60,
    slippagePercent: 1,
    limitPrice: 78000,
    marketPrice: 76000,
    ...BTC,
  };

  it('splits evenly into whole lots with a valid expiration window', () => {
    const plan = planTwap(base, now);
    expect(plan.errors).toEqual([]);
    expect(plan.sliceAmounts).toEqual([1_500_000_000_000_000n, 1_500_000_000_000_000n]);
    expect(plan.durationSeconds).toBe(60);
    // Nado requires now + duration <= expiration <= now + 25h.
    expect(Number(plan.expiration)).toBeGreaterThanOrEqual(now + plan.durationSeconds);
    expect(Number(plan.expiration)).toBeLessThanOrEqual(now + TWAP_MAX_DURATION_SECONDS);
  });

  it('adds the rounding remainder to the last slice so the total is exact', () => {
    const plan = planTwap({ ...base, totalSize: 0.00265, marketPrice: undefined, limitPrice: 90000 }, now);
    expect(plan.sliceAmounts).toEqual([1_300_000_000_000_000n, 1_350_000_000_000_000n]);
    expect(plan.sliceAmounts.reduce((a, b) => a + b, 0n)).toBe(plan.amount);
  });

  it('values buy slices at the lower of limit and market when checking the minimum', () => {
    const plan = planTwap({ ...base, totalSize: 0.0026 }, now); // 0.0013 x $76,000 = $98.80
    expect(plan.errors.join()).toMatch(/worth about \$98\.80, below this market's \$100 minimum/);
  });

  it('enforces Nado limits on executions, interval, slippage and duration', () => {
    expect(planTwap({ ...base, executions: 0 }, now).errors.join()).toMatch(/between 1 and 500/);
    expect(planTwap({ ...base, executions: 501, totalSize: 10 }, now).errors.join()).toMatch(/between 1 and 500/);
    expect(planTwap({ ...base, intervalSeconds: 0 }, now).errors.join()).toMatch(/Interval/);
    expect(planTwap({ ...base, slippagePercent: 11 }, now).errors.join()).toMatch(/slippage/);
    expect(planTwap({ ...base, executions: 26, intervalSeconds: 3600, totalSize: 0.04 }, now).errors.join()).not.toMatch(/25 hours/);
    expect(planTwap({ ...base, executions: 27, intervalSeconds: 3600, totalSize: 0.04 }, now).errors.join()).toMatch(/25 hours/);
  });

  it('refuses limits on the wrong side of the market', () => {
    expect(planTwap({ ...base, limitPrice: 75000 }, now).errors.join()).toMatch(/below the current price/);
    expect(planTwap({ ...base, side: 'sell', limitPrice: 77000 }, now).errors.join()).toMatch(/above the current price/);
  });

  it('signs sells as negative amounts with the limit rounded up', () => {
    const plan = planTwap({ ...base, side: 'sell', limitPrice: 74999.5 }, now);
    expect(plan.amount).toBe(-3_000_000_000_000_000n);
    expect(plan.limitPriceX18).toBe(usd18(75000));
  });
});
