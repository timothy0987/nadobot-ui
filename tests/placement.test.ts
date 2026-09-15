import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cancelLadder,
  INK_SEPOLIA,
  isReduceOnly,
  LadderPlacementError,
  placeLadder,
  placeTwapOrder,
  type LadderInput,
  type PlacedOrder,
  type SignTypedDataAsync,
} from '../src/lib/nado';

const BTC = { priceIncrementX18: 10n ** 18n, sizeIncrementX18: 5n * 10n ** 13n, minOrderValueX18: 100n * 10n ** 18n };
const SENDER = `0x${'ab'.repeat(32)}` as const;
const net = INK_SEPOLIA;

interface Call {
  url: string;
  body: any;
}

/** A fake Nado: records every request and answers like the gateway and trigger service do. */
function fakeNado(opts: { openOrders?: string[]; pendingTriggers?: string[] } = {}) {
  const calls: Call[] = [];
  let digest = 0;
  vi.stubGlobal('fetch', async (url: string, init: any) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body });
    let data: any = {};
    if (body.place_order) data = { digest: `0x${(++digest).toString(16).padStart(64, '0')}` };
    else if (body.type === 'contracts') data = { endpoint_addr: '0x00000000000000000000000000000000000000ee' };
    else if (body.type === 'subaccount_orders') data = { orders: (opts.openOrders ?? []).map((d) => ({ digest: d })) };
    else if (body.type === 'list_trigger_orders') data = { orders: (opts.pendingTriggers ?? []).map((d) => ({ order: { digest: d } })) };
    return { json: async () => ({ status: 'success', data }) };
  });
  return calls;
}

const placements = (calls: Call[]) => calls.filter((c) => c.body.place_order);
const service = (c: Call) => (c.url.startsWith(net.triggerUrl) ? 'trigger' : 'gateway');

describe('placing a ladder', () => {
  const input: LadderInput = {
    productId: 2,
    sender: SENDER,
    side: 'long',
    totalSize: 0.009,
    rungs: 3,
    nearPrice: 75000,
    farPrice: 73000,
    distribution: 'even',
    stopLossPercent: 5,
    takeProfits: [
      { percent: 4, sharePercent: 60 },
      { percent: 8, sharePercent: 40 },
    ],
    expiresInDays: 1,
    bid: 76000,
    ask: 76001,
    ...BTC,
  };
  const sign: SignTypedDataAsync = async () => `0x${'11'.repeat(65)}`;
  afterEach(() => vi.unstubAllGlobals());

  it('places the first entry, then its exits, then the remaining entries', async () => {
    const calls = fakeNado();
    const progress: number[] = [];
    const { placed } = await placeLadder(net, sign, input, (signed) => progress.push(signed));
    const orders = placements(calls);

    expect(orders.map(service)).toEqual(['gateway', 'trigger', 'trigger', 'trigger', 'gateway', 'gateway']);
    expect(placed.map((p) => p.role)).toEqual(['rung', 'stop', 'take-profit', 'take-profit', 'rung', 'rung']);

    const firstRung = placed[0].digest;
    const [, stop, tp1, tp2] = orders;
    // Every exit waits for the first entry and can only reduce the position.
    for (const exit of [stop, tp1, tp2]) {
      expect(exit.body.place_order.trigger.price_trigger.dependency).toEqual({ digest: firstRung, on_partial_fill: true });
      expect(isReduceOnly(exit.body.place_order.order.appendix)).toBe(true);
    }
    expect(Object.keys(stop.body.place_order.trigger.price_trigger.price_requirement)).toEqual(['last_price_below']);
    expect(Object.keys(tp1.body.place_order.trigger.price_trigger.price_requirement)).toEqual(['last_price_above']);

    // Entries go nearest price first and never carry a trigger.
    const entryPrices = orders.filter((c) => service(c) === 'gateway').map((c) => BigInt(c.body.place_order.order.priceX18));
    expect(entryPrices).toEqual([75_000n * 10n ** 18n, 74_000n * 10n ** 18n, 73_000n * 10n ** 18n]);
    expect(progress[progress.length - 1]).toBe(6);
  });

  it('reports what is already live when a signature is rejected partway', async () => {
    fakeNado();
    let count = 0;
    const rejectThird: SignTypedDataAsync = async () => {
      if (++count === 3) throw Object.assign(new Error('User rejected the request'), { shortMessage: 'User rejected the request' });
      return `0x${'11'.repeat(65)}`;
    };
    const error = await placeLadder(net, rejectThird, input).catch((e) => e);
    expect(error).toBeInstanceOf(LadderPlacementError);
    expect(error.message).toBe('User rejected the request');
    expect((error as LadderPlacementError).placed.map((p) => p.role)).toEqual(['rung', 'stop']);
  });

  it('refuses to place a ladder that fails planning', async () => {
    const calls = fakeNado();
    await expect(placeLadder(net, sign, { ...input, stopLossPercent: 1 })).rejects.toThrow(/stop-loss/);
    expect(placements(calls)).toHaveLength(0);
  });
});

describe('cancelling a ladder', () => {
  const orders: PlacedOrder[] = [
    { role: 'rung', service: 'gateway', digest: '0xrung1' },
    { role: 'stop', service: 'trigger', digest: '0xstop' },
    { role: 'take-profit', service: 'trigger', digest: '0xtp' },
    { role: 'rung', service: 'gateway', digest: '0xrung2' },
  ];
  const sign: SignTypedDataAsync = async () => `0x${'22'.repeat(65)}`;
  const cancels = (calls: Call[]) => calls.filter((c) => c.body.cancel_orders).map((c) => ({ service: service(c), digests: c.body.cancel_orders.tx.digests }));

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('only sends orders that are still open, entries first', async () => {
    // rung1 already filled and the take-profit already fired: sending them would make Nado reject the whole batch.
    const calls = fakeNado({ openOrders: ['0xRUNG2'], pendingTriggers: ['0xstop'] });
    const done = cancelLadder(net, sign, SENDER, 2, orders, true);
    await vi.advanceTimersByTimeAsync(3000);
    await done;
    expect(cancels(calls)).toEqual([
      { service: 'gateway', digests: ['0xrung2'] },
      { service: 'trigger', digests: ['0xstop'] },
    ]);
  });

  it('keeps exits in place when only unfilled entries are cancelled', async () => {
    const calls = fakeNado({ openOrders: ['0xrung1', '0xrung2'], pendingTriggers: ['0xstop', '0xtp'] });
    await cancelLadder(net, sign, SENDER, 2, orders, false);
    expect(cancels(calls)).toEqual([{ service: 'gateway', digests: ['0xrung1', '0xrung2'] }]);
    expect(calls.some((c) => c.body.type === 'list_trigger_orders')).toBe(false);
  });

  it('sends nothing when everything is already gone', async () => {
    const calls = fakeNado();
    await cancelLadder(net, sign, SENDER, 2, orders, true);
    expect(cancels(calls)).toEqual([]);
  });
});

describe('placing a TWAP', () => {
  afterEach(() => vi.unstubAllGlobals());
  const sign: SignTypedDataAsync = async () => `0x${'33'.repeat(65)}`;
  const base = { productId: 2, sender: SENDER, side: 'buy' as const, executions: 2, intervalSeconds: 60, slippagePercent: 1, limitPrice: 90000, ...BTC };

  it('sends plain time triggers for even slices', async () => {
    const calls = fakeNado();
    await placeTwapOrder(net, sign, { ...base, totalSize: 0.003 });
    const [order] = placements(calls);
    expect(service(order)).toBe('trigger');
    expect(order.body.place_order.trigger).toEqual({ time_trigger: { interval: 60 } });
    expect((BigInt(order.body.place_order.order.appendix) >> 12n) & 3n).toBe(2n); // TWAP trigger
    expect((BigInt(order.body.place_order.order.appendix) >> 9n) & 3n).toBe(1n); // IOC
  });

  it('sends exact amounts when rounding left the slices uneven', async () => {
    const calls = fakeNado();
    await placeTwapOrder(net, sign, { ...base, totalSize: 0.00265 });
    const [order] = placements(calls);
    expect(order.body.place_order.trigger.time_trigger.amounts).toEqual(['1300000000000000', '1350000000000000']);
    expect((BigInt(order.body.place_order.order.appendix) >> 12n) & 3n).toBe(3n); // TWAP with custom amounts
  });
});
