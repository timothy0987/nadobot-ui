import { describe, expect, it } from 'vitest';
import { assessTradeRisk, maxTradeSize, projectRisk, repriceAccount, type AccountRisk } from '../src/lib/nado';

const LOT = 5n * 10n ** 13n; // 0.00005 BTC
const weights = { 2: { price: 75000, longInitial: 0.95, shortInitial: 1.05, longMaintenance: 0.97, shortMaintenance: 1.03 } };
const flat: AccountRisk = { equity: 1000, availableMargin: 1000, maintenanceMargin: 1000, perps: {}, weights };
const margin = (a: AccountRisk, amount: number, price: number) => projectRisk(repriceAccount(a, 2, price), [{ productId: 2, amount, price }]).availableMargin;

describe('the largest order the margin allows', () => {
  it('uses 20x on a 0.95 weight, less the safety buffer', () => {
    // Each BTC long costs 5% of $75,000 = $3,750 of margin; $950 usable -> 0.25333 BTC, rounded down to the lot.
    const size = maxTradeSize(flat, { productId: 2, side: 'long', price: 75000, sizeIncrementX18: LOT });
    expect(size).toBeCloseTo(0.2533, 4);
    expect(margin(flat, size, 75000)).toBeGreaterThanOrEqual(50);
    expect(margin(flat, size + 0.00005, 75000)).toBeLessThan(50);
  });

  it('is exact at the boundary with no buffer', () => {
    const size = maxTradeSize(flat, { productId: 2, side: 'short', price: 75000, sizeIncrementX18: LOT, buffer: 0 });
    expect(margin(flat, -size, 75000)).toBeGreaterThanOrEqual(0);
    expect(margin(flat, -(size + 0.00005), 75000)).toBeLessThan(0);
  });

  it('counts closing an opposite position first', () => {
    // Short 0.2 BTC opened at 75,000: flipping to long can go past 0.2 before new margin is needed.
    const short: AccountRisk = projectRisk(flat, [{ productId: 2, amount: -0.2, price: 75000 }]);
    const buy = maxTradeSize(short, { productId: 2, side: 'long', price: 75000, sizeIncrementX18: LOT });
    const sell = maxTradeSize(short, { productId: 2, side: 'short', price: 75000, sizeIncrementX18: LOT });
    expect(buy).toBeGreaterThan(0.2 + sell);
  });

  it('returns 0 without room, a price, or the market', () => {
    const broke = { ...flat, availableMargin: -10 };
    expect(maxTradeSize(broke, { productId: 2, side: 'long', price: 75000, sizeIncrementX18: LOT })).toBe(0);
    expect(maxTradeSize(flat, { productId: 2, side: 'long', price: 0, sizeIncrementX18: LOT })).toBe(0);
    expect(maxTradeSize(flat, { productId: 9, side: 'long', price: 75000, sizeIncrementX18: LOT })).toBe(0);
  });

  it('keeps liquidation at least 1% of the price past the stop-loss', () => {
    const noStop = maxTradeSize(flat, { productId: 2, side: 'long', price: 75000, sizeIncrementX18: LOT });
    const stopPrice = 72750; // 3% below
    const size = maxTradeSize(flat, { productId: 2, side: 'long', price: 75000, sizeIncrementX18: LOT, stopPrice });
    expect(size).toBeGreaterThan(0);
    expect(size).toBeLessThan(noStop);
    const liq = (amount: number) => assessTradeRisk(flat, { productId: 2, fills: [{ productId: 2, amount, price: 75000 }], stopPrice }).liquidationPrice!;
    expect(assessTradeRisk(flat, { productId: 2, fills: [{ productId: 2, amount: size, price: 75000 }], stopPrice }).errors).toEqual([]);
    expect(stopPrice - liq(size)).toBeGreaterThanOrEqual(750);
    expect(stopPrice - liq(size + 0.00005)).toBeLessThan(750);
    // A short's stop sits above the price, and its liquidation above that.
    const short = maxTradeSize(flat, { productId: 2, side: 'short', price: 75000, sizeIncrementX18: LOT, stopPrice: 77250 });
    const shortLiq = assessTradeRisk(flat, { productId: 2, fills: [{ productId: 2, amount: -short, price: 75000 }], stopPrice: 77250 }).liquidationPrice!;
    expect(shortLiq - 77250).toBeGreaterThanOrEqual(750);
  });

  it('judges margin at the fill price', () => {
    const cheaper = maxTradeSize(flat, { productId: 2, side: 'long', price: 60000, sizeIncrementX18: LOT });
    expect(cheaper).toBeGreaterThan(maxTradeSize(flat, { productId: 2, side: 'long', price: 75000, sizeIncrementX18: LOT }));
  });
});
