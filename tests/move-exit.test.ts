import { afterEach, describe, expect, it, vi } from 'vitest';
import { fromX18, INK_SEPOLIA, isReduceOnly, planTriggerEdit, replaceTriggerOrder, type SignTypedDataAsync } from '../src/lib/nado';

const tick = 10n ** 18n;
const sign: SignTypedDataAsync = async () => `0x${'55'.repeat(65)}`;
const SENDER = `0x${'cd'.repeat(32)}` as const;

describe('moving an exit', () => {
  it('prices a long’s stop-loss to fill up to 0.5% below the trigger', () => {
    const plan = planTriggerEdit({ triggerPrice: 70000, closesLong: true, above: false, priceIncrementX18: tick, marketPrice: 75000 });
    expect(plan.errors).toEqual([]);
    expect(fromX18(plan.triggerX18)).toBe(70000);
    expect(fromX18(plan.limitX18)).toBe(69650); // 70,000 - 0.5%
  });

  it('prices a short’s exit to fill up to 0.5% above the trigger', () => {
    const plan = planTriggerEdit({ triggerPrice: 80000, closesLong: false, above: true, priceIncrementX18: tick, marketPrice: 75000 });
    expect(fromX18(plan.limitX18)).toBe(80400); // 80,000 + 0.5%
  });

  it('refuses a level the market has already passed', () => {
    const stopTooHigh = planTriggerEdit({ triggerPrice: 76000, closesLong: true, above: false, priceIncrementX18: tick, marketPrice: 75000 });
    expect(stopTooHigh.errors.join()).toMatch(/already at or below \$76,000, so this would fire straight away/);
    const targetTooLow = planTriggerEdit({ triggerPrice: 74000, closesLong: true, above: true, priceIncrementX18: tick, marketPrice: 75000 });
    expect(targetTooLow.errors.join()).toMatch(/already at or above \$74,000/);
  });

  it('accepts a level still ahead of the market, and asks for a price when empty', () => {
    expect(planTriggerEdit({ triggerPrice: 81000, closesLong: true, above: true, priceIncrementX18: tick, marketPrice: 75000 }).errors).toEqual([]);
    expect(planTriggerEdit({ triggerPrice: 0, closesLong: true, above: false, priceIncrementX18: tick }).errors).toContain('Enter a trigger price.');
  });

  it('rounds the trigger to the market tick', () => {
    const plan = planTriggerEdit({ triggerPrice: 69999.6, closesLong: true, above: false, priceIncrementX18: tick, marketPrice: 75000 });
    expect(fromX18(plan.triggerX18)).toBe(70000);
  });
});

describe('replacing the order on Nado', () => {
  afterEach(() => vi.unstubAllGlobals());

  const fakeNado = (opts: { failCancel?: boolean } = {}) => {
    const calls: { url: string; body: any }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: any) => {
      const body = JSON.parse(init.body);
      calls.push({ url, body });
      if (body.cancel_orders && opts.failCancel) return { json: async () => ({ status: 'failure', error: 'Order not found' }) };
      if (body.type === 'contracts') return { json: async () => ({ status: 'success', data: { endpoint_addr: `0x${'ee'.repeat(20)}` } }) };
      return { json: async () => ({ status: 'success', data: { digest: '0xnew' } }) };
    });
    return calls;
  };
  const plan = planTriggerEdit({ triggerPrice: 70000, closesLong: true, above: false, priceIncrementX18: tick, marketPrice: 75000 });

  it('places the replacement before cancelling the old exit', async () => {
    const calls = fakeNado();
    const result = await replaceTriggerOrder(INK_SEPOLIA, sign, {
      productId: 2,
      sender: SENDER,
      oldDigest: '0xold',
      amount: -(10n ** 16n),
      plan,
      above: false,
      dependsOn: '0xentry',
    });

    expect(result).toEqual({ digest: '0xnew', oldCancelled: true });
    const actions = calls.filter((c) => c.body.place_order || c.body.cancel_orders);
    expect(actions.map((c) => (c.body.place_order ? 'place' : 'cancel'))).toEqual(['place', 'cancel']);

    const placed = actions[0].body.place_order;
    expect(placed.trigger.price_trigger.price_requirement).toEqual({ last_price_below: plan.triggerX18.toString() });
    expect(placed.trigger.price_trigger.dependency).toEqual({ digest: '0xentry', on_partial_fill: true });
    expect(isReduceOnly(placed.order.appendix)).toBe(true);
    expect(BigInt(placed.order.priceX18)).toBe(plan.limitX18);
    expect(actions[1].body.cancel_orders.tx.digests).toEqual(['0xold']);
  });

  it('keeps the new exit and reports it when the old one cannot be cancelled', async () => {
    fakeNado({ failCancel: true });
    const result = await replaceTriggerOrder(INK_SEPOLIA, sign, { productId: 2, sender: SENDER, oldDigest: '0xold', amount: -(10n ** 16n), plan, above: false });
    expect(result).toEqual({ digest: '0xnew', oldCancelled: false });
  });

  it('never touches the old exit when the new price is invalid', async () => {
    const calls = fakeNado();
    const bad = planTriggerEdit({ triggerPrice: 76000, closesLong: true, above: false, priceIncrementX18: tick, marketPrice: 75000 });
    await expect(
      replaceTriggerOrder(INK_SEPOLIA, sign, { productId: 2, sender: SENDER, oldDigest: '0xold', amount: -(10n ** 16n), plan: bad, above: false })
    ).rejects.toThrow(/fire straight away/);
    expect(calls).toHaveLength(0);
  });
});
