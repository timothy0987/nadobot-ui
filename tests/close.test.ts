import { afterEach, describe, expect, it, vi } from 'vitest';
import { closePosition, fromX18, INK_SEPOLIA, isReduceOnly, planClose, type SignTypedDataAsync } from '../src/lib/nado';

const BTC = { priceIncrementX18: 10n ** 18n, sizeIncrementX18: 5n * 10n ** 13n, minOrderValueX18: 100n * 10n ** 18n };
const long = 10n ** 16n; // 0.01 BTC
const market = { bid: 75000, ask: 75001 };

describe('closing a position', () => {
  it('sells into the bid to close a long, capped 1% below it', () => {
    const plan = planClose({ positionAmount: long, fraction: 1, ...market, ...BTC });
    expect(plan.errors).toEqual([]);
    expect(plan.amount).toBe(-long); // the exact position size, so nothing is left behind
    expect(plan.limitPriceX18).toBe(74_250n * 10n ** 18n);
    expect(plan.notional).toBeCloseTo(750, 9);
    expect(plan.fractionClosed).toBe(1);
  });

  it('buys from the ask to close a short, capped 1% above it', () => {
    const plan = planClose({ positionAmount: -long, fraction: 1, ...market, ...BTC });
    expect(plan.amount).toBe(long);
    expect(fromX18(plan.limitPriceX18)).toBe(75752); // 75,001 + 1% = 75,751.01, rounded up so the buy still crosses
  });

  it('rounds a partial close down to whole lots', () => {
    const plan = planClose({ positionAmount: 3_330_000_000_000_000n, fraction: 0.25, ...market, ...BTC });
    expect(plan.amount).toBe(-800_000_000_000_000n); // 0.0008325 -> 0.0008 BTC
    expect(plan.amount % BTC.sizeIncrementX18).toBe(0n);
    expect(plan.fractionClosed).toBeCloseTo(0.24, 2);
  });

  it('refuses a share below the market minimum order', () => {
    const plan = planClose({ positionAmount: long, fraction: 0.1, ...market, ...BTC });
    expect(plan.errors.join()).toMatch(/only about \$75\.00, below this market's \$100 minimum/);
  });

  it('refuses a share smaller than one lot, and an empty position', () => {
    expect(planClose({ positionAmount: 5n * 10n ** 13n, fraction: 0.25, ...market, ...BTC }).errors.join()).toMatch(/minimum lot size/);
    expect(planClose({ positionAmount: 0n, fraction: 1, ...market, ...BTC }).errors).toContain('There is no position to close.');
  });

  it('refuses to guess a price when the market has no quote', () => {
    expect(planClose({ positionAmount: long, fraction: 1, bid: null, ask: null, ...BTC }).errors.join()).toMatch(/No market price/);
  });

  it('accepts a custom slippage cap', () => {
    const plan = planClose({ positionAmount: long, fraction: 1, ...market, slippagePercent: 0.2, ...BTC });
    expect(fromX18(plan.limitPriceX18)).toBe(74850); // 75,000 - 0.2%
  });
});

describe('placing the closing order', () => {
  afterEach(() => vi.unstubAllGlobals());
  const sign: SignTypedDataAsync = async () => `0x${'44'.repeat(65)}`;

  it('sends one immediate-or-cancel reduce-only order', async () => {
    const bodies: any[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: any) => {
      bodies.push(JSON.parse(init.body));
      return { json: async () => ({ status: 'success', data: { digest: '0xclose' } }) };
    });
    const plan = planClose({ positionAmount: long, fraction: 0.5, ...market, ...BTC });
    const digest = await closePosition(INK_SEPOLIA, sign, { productId: 2, sender: `0x${'ab'.repeat(32)}`, plan });

    expect(digest).toBe('0xclose');
    const order = bodies[0].place_order.order;
    expect(BigInt(order.amount)).toBe(-(5n * 10n ** 15n));
    expect(isReduceOnly(order.appendix)).toBe(true);
    expect((BigInt(order.appendix) >> 9n) & 3n).toBe(1n); // IOC
  });

  it('never sends an order that failed its checks', async () => {
    const calls: unknown[] = [];
    vi.stubGlobal('fetch', async () => {
      calls.push(1);
      return { json: async () => ({ status: 'success', data: { digest: '0x' } }) };
    });
    const plan = planClose({ positionAmount: long, fraction: 0.1, ...market, ...BTC });
    await expect(closePosition(INK_SEPOLIA, sign, { productId: 2, sender: `0x${'ab'.repeat(32)}`, plan })).rejects.toThrow(/minimum order/);
    expect(calls).toHaveLength(0);
  });
});
