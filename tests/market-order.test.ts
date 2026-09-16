import { afterEach, describe, expect, it, vi } from 'vitest';
import { filledAmount, fromX18, INK_SEPOLIA, isReduceOnly, placeMarketOrder, planMarketOrder, protectFill, type SignTypedDataAsync } from '../src/lib/nado';

const BTC = { priceIncrementX18: 10n ** 18n, sizeIncrementX18: 5n * 10n ** 13n, minOrderValueX18: 100n * 10n ** 18n };
const market = { bid: 75000, ask: 75001 };
const SENDER = `0x${'ab'.repeat(32)}` as const;
const sign: SignTypedDataAsync = async () => `0x${'66'.repeat(65)}`;

describe('planning a market order', () => {
  it('buys by lifting the ask, capped 1% above it', () => {
    const plan = planMarketOrder({ side: 'long', size: 0.0133, ...market, ...BTC });
    expect(plan.errors).toEqual([]);
    expect(plan.amount).toBe(13_300_000_000_000_000n);
    expect(fromX18(plan.limitPriceX18)).toBe(75752); // 75,001 + 1%, rounded up so it still crosses
    expect(plan.expectedPrice).toBe(75001);
    expect(plan.notional).toBeCloseTo(0.0133 * 75001, 6);
  });

  it('sells by hitting the bid, capped 1% below it', () => {
    const plan = planMarketOrder({ side: 'short', size: 0.01, ...market, ...BTC });
    expect(plan.amount).toBe(-(10n ** 16n));
    expect(fromX18(plan.limitPriceX18)).toBe(74250);
  });

  it('sets exits from the expected fill price, on the right side for each direction', () => {
    const long = planMarketOrder({ side: 'long', size: 0.01, stopLossPercent: 3, takeProfitPercent: 6, ...market, ...BTC });
    expect(fromX18(long.stopX18!)).toBe(72751); // 75,001 - 3%
    expect(fromX18(long.takeProfitX18!)).toBe(79501); // 75,001 + 6%
    const short = planMarketOrder({ side: 'short', size: 0.01, stopLossPercent: 3, takeProfitPercent: 6, ...market, ...BTC });
    expect(fromX18(short.stopX18!)).toBe(77250);
    expect(fromX18(short.takeProfitX18!)).toBe(70500);
  });

  it('leaves exits out when not asked for', () => {
    const plan = planMarketOrder({ side: 'long', size: 0.01, ...market, ...BTC });
    expect(plan.stopX18).toBeNull();
    expect(plan.takeProfitX18).toBeNull();
  });

  it('refuses orders Nado would reject', () => {
    expect(planMarketOrder({ side: 'long', size: 0.001, ...market, ...BTC }).errors.join()).toMatch(/below this market's \$100 minimum/);
    expect(planMarketOrder({ side: 'long', size: 0.00001, ...market, ...BTC }).errors.join()).toMatch(/minimum lot size/);
    expect(planMarketOrder({ side: 'long', size: 0.01, bid: null, ask: null, ...BTC }).errors.join()).toMatch(/No market price/);
  });
});

describe('what filled', () => {
  it('is the position change, never more than was ordered', () => {
    expect(filledAmount(0n, 10n, 10n)).toBe(10n);
    expect(filledAmount(5n, 12n, 10n)).toBe(7n); // partial fill on top of an existing long
    expect(filledAmount(0n, 15n, 10n)).toBe(10n); // another fill landed at the same time
    expect(filledAmount(0n, 0n, 10n)).toBe(0n); // IOC found no liquidity
    expect(filledAmount(0n, -8n, -10n)).toBe(-8n);
    expect(filledAmount(10n, 4n, -10n)).toBe(-6n); // a sell that reduced a long
    expect(filledAmount(0n, 3n, -10n)).toBe(0n); // position moved the other way: nothing of ours filled
  });
});

describe('placing it on Nado', () => {
  afterEach(() => vi.unstubAllGlobals());
  const capture = () => {
    const bodies: any[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: any) => {
      bodies.push(JSON.parse(init.body));
      return { json: async () => ({ status: 'success', data: { digest: `0x${bodies.length}` } }) };
    });
    return bodies;
  };

  it('sends an immediate-or-cancel order that can open a position', async () => {
    const bodies = capture();
    const plan = planMarketOrder({ side: 'long', size: 0.01, ...market, ...BTC });
    await placeMarketOrder(INK_SEPOLIA, sign, { productId: 2, sender: SENDER, plan });
    const appendix = BigInt(bodies[0].place_order.order.appendix);
    expect((appendix >> 9n) & 3n).toBe(1n); // IOC
    expect(isReduceOnly(appendix.toString())).toBe(false);
  });

  it('protects exactly what filled with reduce-only exits', async () => {
    const bodies = capture();
    const plan = planMarketOrder({ side: 'long', size: 0.01, stopLossPercent: 3, takeProfitPercent: 6, ...market, ...BTC });
    const placed = await protectFill(INK_SEPOLIA, sign, { productId: 2, sender: SENDER, filled: 6n * 10n ** 15n, plan, priceIncrementX18: BTC.priceIncrementX18 });
    expect(placed).toHaveLength(2);
    const [stop, target] = bodies.map((b) => b.place_order);
    for (const exit of [stop, target]) {
      expect(BigInt(exit.order.amount)).toBe(-(6n * 10n ** 15n)); // sized to the fill, not the order
      expect(isReduceOnly(exit.order.appendix)).toBe(true);
    }
    expect(stop.trigger.price_trigger.price_requirement).toEqual({ last_price_below: plan.stopX18!.toString() });
    expect(target.trigger.price_trigger.price_requirement).toEqual({ last_price_above: plan.takeProfitX18!.toString() });
  });

  it('never sends an order that failed its checks', async () => {
    const bodies = capture();
    const plan = planMarketOrder({ side: 'long', size: 0.001, ...market, ...BTC });
    await expect(placeMarketOrder(INK_SEPOLIA, sign, { productId: 2, sender: SENDER, plan })).rejects.toThrow(/minimum/);
    expect(bodies).toHaveLength(0);
  });
});
