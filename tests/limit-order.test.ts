import { afterEach, describe, expect, it, vi } from 'vitest';
import { fromX18, INK_SEPOLIA, isReduceOnly, placeLimitOrder, planLimitOrder, type SignTypedDataAsync } from '../src/lib/nado';

const BTC = { priceIncrementX18: 10n ** 18n, sizeIncrementX18: 5n * 10n ** 13n, minOrderValueX18: 100n * 10n ** 18n };
const market = { bid: 75000, ask: 75001 };
const base = { side: 'long' as const, price: 74500.6, size: 0.01, postOnly: true, ...market, ...BTC };
// Exact x18 integers: converting to a JS number for display can add float noise.
const usd18 = (dollars: number) => BigInt(dollars) * 10n ** 18n;
const orderType = (appendix: string) => Number((BigInt(appendix) >> 9n) & 3n);

describe('planning a limit order', () => {
  it('rounds a buy down and a sell up, never paying worse than asked', () => {
    expect(planLimitOrder(base).priceX18).toBe(usd18(74500));
    expect(planLimitOrder({ ...base, side: 'short', price: 75500.2 }).priceX18).toBe(usd18(75501));
  });

  it('refuses a post-only order that would take liquidity', () => {
    const buy = planLimitOrder({ ...base, price: 75001 });
    expect(buy.crosses).toBe(true);
    expect(buy.errors.join()).toMatch(/post-only buy must rest below the ask \(\$75,001\).*Lower the price/);
    const sell = planLimitOrder({ ...base, side: 'short', price: 75000 });
    expect(sell.errors.join()).toMatch(/above the bid.*Raise the price/);
  });

  it('only warns when a crossing order is allowed to take', () => {
    const plan = planLimitOrder({ ...base, price: 75100, postOnly: false });
    expect(plan.errors).toEqual([]);
    expect(plan.warnings.join()).toMatch(/fill straight away, like a market order/);
  });

  it('prices exits from the limit price on the right side', () => {
    const long = planLimitOrder({ ...base, price: 70000, stopLossPercent: 5, takeProfitPercent: 10 });
    expect(long.stop!.triggerX18).toBe(usd18(66500));
    expect(fromX18(long.stop!.limitX18)).toBeLessThan(66500);
    expect(long.takeProfit!.triggerX18).toBe(usd18(77000));
    const short = planLimitOrder({ ...base, side: 'short', price: 80000, stopLossPercent: 5, takeProfitPercent: 10 });
    expect(short.stop!.triggerX18).toBe(usd18(84000));
    expect(short.takeProfit!.triggerX18).toBe(usd18(72000));
    expect(fromX18(short.stop!.limitX18)).toBeGreaterThan(84000);
  });

  it('leaves exits out when not asked for', () => {
    const plan = planLimitOrder(base);
    expect(plan.stop).toBeNull();
    expect(plan.takeProfit).toBeNull();
  });

  it('checks the minimum order at the limit price, and needs a price and size', () => {
    expect(planLimitOrder({ ...base, size: 0.001 }).errors.join()).toMatch(/below this market's \$100 minimum/);
    expect(planLimitOrder({ ...base, price: 0 }).errors).toContain('Enter a limit price.');
    expect(planLimitOrder({ ...base, size: 0 }).errors.join()).toMatch(/minimum lot size/);
  });
});

describe('placing it on Nado', () => {
  afterEach(() => vi.unstubAllGlobals());
  const sign: SignTypedDataAsync = async () => `0x${'77'.repeat(65)}`;
  const capture = () => {
    const bodies: any[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: any) => {
      bodies.push(JSON.parse(init.body));
      return { json: async () => ({ status: 'success', data: { digest: `0xd${bodies.length}` } }) };
    });
    return bodies;
  };
  const sender = `0x${'ab'.repeat(32)}` as const;

  it('sends a post-only entry, then exits that wait for it and only reduce', async () => {
    const bodies = capture();
    const plan = planLimitOrder({ ...base, price: 70000, stopLossPercent: 5, takeProfitPercent: 10 });
    const result = await placeLimitOrder(INK_SEPOLIA, sign, { productId: 2, sender, plan, expiresInDays: 7 });

    expect(result).toEqual({ entry: '0xd1', exits: ['0xd2', '0xd3'] });
    const [entry, stop, target] = bodies.map((b) => b.place_order);
    expect(orderType(entry.order.appendix)).toBe(3); // post-only
    expect(entry.trigger).toBeUndefined();
    expect(isReduceOnly(entry.order.appendix)).toBe(false);
    for (const exit of [stop, target]) {
      expect(exit.trigger.price_trigger.dependency).toEqual({ digest: '0xd1', on_partial_fill: true });
      expect(isReduceOnly(exit.order.appendix)).toBe(true);
      expect(BigInt(exit.order.amount)).toBe(-plan.amount);
    }
    expect(stop.trigger.price_trigger.price_requirement).toEqual({ last_price_below: plan.stop!.triggerX18.toString() });
    expect(target.trigger.price_trigger.price_requirement).toEqual({ last_price_above: plan.takeProfit!.triggerX18.toString() });
  });

  it('sends a plain limit order when post-only is off, and nothing else without exits', async () => {
    const bodies = capture();
    const plan = planLimitOrder({ ...base, postOnly: false });
    const result = await placeLimitOrder(INK_SEPOLIA, sign, { productId: 2, sender, plan, expiresInDays: 1 });
    expect(result.exits).toEqual([]);
    expect(bodies).toHaveLength(1);
    expect(orderType(bodies[0].place_order.order.appendix)).toBe(0);
  });

  it('never sends an order that failed its checks', async () => {
    const bodies = capture();
    const plan = planLimitOrder({ ...base, price: 75001 });
    await expect(placeLimitOrder(INK_SEPOLIA, sign, { productId: 2, sender, plan, expiresInDays: 7 })).rejects.toThrow(/post-only/);
    expect(bodies).toHaveLength(0);
  });
});
