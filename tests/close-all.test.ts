import { describe, expect, it, vi } from 'vitest';
import { closeAllPositions, fromX18, INK_SEPOLIA, planCloseAll, type CloseAllEntry, type ProductSymbol, type SignTypedDataAsync } from '../src/lib/nado';

const SENDER = `0x${'ab'.repeat(32)}` as const;
const net = INK_SEPOLIA;

const BTC: ProductSymbol = {
  type: 'perp',
  product_id: 2,
  symbol: 'BTC-PERP',
  trading_status: 'live',
  price_increment_x18: (10n ** 18n).toString(),
  size_increment: (5n * 10n ** 13n).toString(),
  min_size: (100n * 10n ** 18n).toString(),
};
const ETH: ProductSymbol = {
  type: 'perp',
  product_id: 3,
  symbol: 'ETH-PERP',
  trading_status: 'live',
  price_increment_x18: (10n ** 16n).toString(),
  size_increment: (10n ** 15n).toString(),
  min_size: (100n * 10n ** 18n).toString(),
};
const products = { [BTC.product_id]: BTC, [ETH.product_id]: ETH };
const x18 = (n: number) => BigInt(Math.round(n * 1e18));

describe('planning a close-all', () => {
  it('prices each position at its own market, full size', () => {
    const positions = [
      { productId: BTC.product_id, symbol: 'BTC-PERP', amountX18: x18(0.02) }, // long
      { productId: ETH.product_id, symbol: 'ETH-PERP', amountX18: -x18(1.5) }, // short
    ];
    const quotes = { [BTC.product_id]: { bid: 75000, ask: 75001 }, [ETH.product_id]: { bid: 3000, ask: 3001 } };
    const [btc, eth] = planCloseAll(positions, quotes, products);

    expect(btc.plan.errors).toEqual([]);
    expect(btc.plan.amount).toBe(-x18(0.02)); // sells to close the long
    expect(btc.plan.fractionClosed).toBe(1);
    expect(eth.plan.errors).toEqual([]);
    expect(eth.plan.amount).toBe(x18(1.5)); // buys to close the short
  });

  it('skips flat positions', () => {
    const positions = [{ productId: BTC.product_id, symbol: 'BTC-PERP', amountX18: 0n }];
    expect(planCloseAll(positions, {}, products)).toEqual([]);
  });

  it('carries an error instead of dropping a position with no market or quote', () => {
    const positions = [
      { productId: 999, symbol: 'GHOST-PERP', amountX18: x18(1) },
      { productId: BTC.product_id, symbol: 'BTC-PERP', amountX18: x18(1) },
    ];
    const [ghost, btc] = planCloseAll(positions, {}, products);
    expect(ghost.plan.errors.join()).toMatch(/details could not be loaded/);
    expect(btc.plan.errors.join()).toMatch(/No market price available/);
  });
});

describe('closing every position', () => {
  const sign: SignTypedDataAsync = async () => `0x${'77'.repeat(65)}`;

  function fakeNado() {
    let digest = 0;
    vi.stubGlobal('fetch', async (_url: string, init: any) => {
      JSON.parse(init.body);
      return { json: async () => ({ status: 'success', data: { digest: `0xd${++digest}` } }) };
    });
  }

  const entries = (positions: { productId: number; symbol: string; amountX18: bigint }[], quotes: Record<number, { bid: number | null; ask: number | null }>) =>
    planCloseAll(positions, quotes, products);

  it('closes every position and reports each one', async () => {
    fakeNado();
    const list: CloseAllEntry[] = entries(
      [
        { productId: BTC.product_id, symbol: 'BTC-PERP', amountX18: x18(0.02) },
        { productId: ETH.product_id, symbol: 'ETH-PERP', amountX18: -x18(1.5) },
      ],
      { [BTC.product_id]: { bid: 75000, ask: 75001 }, [ETH.product_id]: { bid: 3000, ask: 3001 } }
    );
    const progress: [number, number][] = [];
    const results = await closeAllPositions(net, sign, SENDER, list, (done, total) => progress.push([done, total]));

    expect(results).toEqual([
      { productId: BTC.product_id, symbol: 'BTC-PERP', ok: true },
      { productId: ETH.product_id, symbol: 'ETH-PERP', ok: true },
    ]);
    expect(progress).toEqual([
      [1, 2],
      [2, 2],
    ]);
    vi.unstubAllGlobals();
  });

  it('keeps going after one signature is rejected, and never sends a position that already has an error', async () => {
    fakeNado();
    let calls = 0;
    const flaky: SignTypedDataAsync = async (args) => {
      calls++;
      if (calls === 1) throw new Error('User rejected the request');
      return sign(args);
    };
    const list = entries(
      [
        { productId: BTC.product_id, symbol: 'BTC-PERP', amountX18: x18(0.02) }, // rejected
        { productId: 999, symbol: 'GHOST-PERP', amountX18: x18(1) }, // no market: never signed
        { productId: ETH.product_id, symbol: 'ETH-PERP', amountX18: -x18(1.5) }, // succeeds
      ],
      { [BTC.product_id]: { bid: 75000, ask: 75001 }, [ETH.product_id]: { bid: 3000, ask: 3001 } }
    );
    const results = await closeAllPositions(net, flaky, SENDER, list);

    expect(results[0]).toEqual({ productId: BTC.product_id, symbol: 'BTC-PERP', ok: false, error: 'User rejected the request' });
    expect(results[1]).toMatchObject({ productId: 999, ok: false });
    expect(results[1].error).toMatch(/details could not be loaded/);
    expect(results[2]).toEqual({ productId: ETH.product_id, symbol: 'ETH-PERP', ok: true });
    // Only the two closeable positions ever asked for a signature.
    expect(calls).toBe(2);
    vi.unstubAllGlobals();
  });
});
