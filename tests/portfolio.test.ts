import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildOpenPositions,
  fetchFillsSince,
  fetchPositions,
  INK_SEPOLIA,
  positionNetPnl,
  summarizeFills,
  type Match,
  type PositionRecord,
} from '../src/lib/nado';

const DAY = 86400;
const x18 = (n: number) => (BigInt(Math.round(n * 1e9)) * 10n ** 9n).toString();
const fill = (over: Partial<Match>): Match => ({
  digest: '0x',
  productId: 2,
  submissionIdx: '1',
  timestamp: 0,
  baseFilled: 0,
  quoteFilled: 0,
  fee: 0,
  realizedPnl: 0,
  builderFee: 0,
  isTaker: true,
  builderId: 0,
  ...over,
});

describe('summarizing fills', () => {
  const since = 10 * DAY;
  const now = 13 * DAY - 1;
  const fills = [
    fill({ timestamp: 10 * DAY + 100, quoteFilled: -1000, fee: 0.5 }),
    fill({ timestamp: 11 * DAY + 5, quoteFilled: 500, fee: -0.1, realizedPnl: 20, isTaker: false }),
    fill({ timestamp: 12 * DAY + 50, quoteFilled: -200, fee: 0.2, realizedPnl: -5, builderId: 7 }),
    fill({ timestamp: 9 * DAY, quoteFilled: -9999, fee: 9 }), // before the range
  ];

  it('totals volume, fees and PnL inside the range only', () => {
    const s = summarizeFills(fills, since, now, 7);
    expect(s.volume).toBe(1700);
    expect(s.fills).toBe(3);
    expect(s.makerVolume).toBe(500);
    expect(s.fees).toBeCloseTo(0.6, 9);
    expect(s.realizedPnl).toBe(15);
    expect(s.netPnl).toBeCloseTo(14.4, 9);
    expect(s.builderVolume).toBe(200);
  });

  it('only counts builder volume for the configured builder', () => {
    expect(summarizeFills(fills, since, now, 0).builderVolume).toBe(0);
    expect(summarizeFills(fills, since, now, 8).builderVolume).toBe(0);
  });

  it('buckets by UTC day, keeping empty days, with fees taken off PnL', () => {
    const s = summarizeFills(fills, since, now);
    expect(s.buckets.map((b) => b.start)).toEqual([10 * DAY, 11 * DAY, 12 * DAY]);
    expect(s.buckets.map((b) => b.volume)).toEqual([1000, 500, 200]);
    expect(s.buckets[0].pnl).toBeCloseTo(-0.5, 9);
    expect(s.buckets[1].pnl).toBeCloseTo(20.1, 9);
    expect(s.buckets[2].pnl).toBeCloseTo(-5.2, 9);
    const empty = summarizeFills([], since, now);
    expect(empty.buckets).toHaveLength(3);
    expect(empty.volume).toBe(0);
  });

  it('can bucket by hour for a 24h view', () => {
    const end = 20 * DAY + 1800; // half past the hour
    expect(summarizeFills([], end - DAY, end, 0, 3600).buckets).toHaveLength(25);
  });
});

describe('open positions', () => {
  const info = {
    perp_balances: [
      { product_id: 2, balance: { amount: x18(0.005), v_quote_balance: x18(-385.19) } },
      { product_id: 4, balance: { amount: x18(-0.1), v_quote_balance: x18(300) } },
      { product_id: 6, balance: { amount: '0', v_quote_balance: '0' } },
    ],
  };
  const record: PositionRecord = {
    productId: 2,
    isolated: false,
    long: true,
    open: true,
    openId: '100',
    size: 0.005,
    maxSize: 0.005,
    entryPrice: 78003.21,
    exitPrice: 0,
    fees: 0.18,
    realizedPnl: 0,
    funding: -0.01,
    liquidatedSize: 0,
    openedAt: 1,
    updatedAt: 2,
  };

  it("joins gateway sizes with the indexer's entry, marks and sorts by value", () => {
    const views = buildOpenPositions(info, [record], { 2: 75394.84, 4: 2900 });
    expect(views.map((v) => v.productId)).toEqual([2, 4]);
    const [btc, eth] = views;
    expect(btc.entryPrice).toBe(78003.21);
    expect(btc.unrealizedPnl).toBeCloseTo((75394.84 - 78003.21) * 0.005, 9);
    expect(btc.funding).toBe(-0.01);
    expect(eth.long).toBe(false);
    // No indexer record yet: entry falls back to the gateway's cost basis (300 / 0.1).
    expect(eth.entryPrice).toBeCloseTo(3000, 9);
    expect(eth.unrealizedPnl).toBeCloseTo(10, 9);
    expect(eth.unrealizedPercent).toBeCloseTo((10 / 300) * 100, 9);
  });

  it('nets a closed position’s PnL with fees and funding', () => {
    expect(positionNetPnl({ ...record, realizedPnl: 12, fees: 0.5, funding: -0.25 })).toBeCloseTo(11.25, 9);
  });
});

describe('indexer paging', () => {
  afterEach(() => vi.unstubAllGlobals());
  const respond = (payload: unknown) => ({ json: async () => payload });

  it('returns the next page cursor only when a page is full', async () => {
    const bodies: any[] = [];
    const position = (openId: string) => ({ product_id: 2, direction: true, close_id: '5', open_id: openId, amount: '0', max_amount: '0', average_entry_price: '0', average_exit_price: '0', open_fee: '0', close_fee: '0', realized_pnl: '0', net_funding_payment: '0', liquidated_amount: '0', open_timestamp: '1', update_timestamp: '2' });
    vi.stubGlobal('fetch', async (_url: string, init: any) => {
      bodies.push(JSON.parse(init.body));
      return respond({ positions: bodies.length === 1 ? [position('30'), position('25')] : [position('9')] });
    });
    const full = await fetchPositions(INK_SEPOLIA, '0xabc', { limit: 2, open: false });
    expect(full.nextIdx).toBe('24');
    expect(bodies[0]).toEqual({ positions: { subaccount: '0xabc', limit: 2, open: false } });
    const last = await fetchPositions(INK_SEPOLIA, '0xabc', { limit: 2, idx: full.nextIdx! });
    expect(last.nextIdx).toBeNull();
    expect(bodies[1].positions.idx).toBe('24');
  });

  it('pages fills back to the start of the range and stops there', async () => {
    const page = (fromIdx: number, count: number, startTime: number) => ({
      matches: Array.from({ length: count }, (_, i) => ({ digest: '0x', submission_idx: String(fromIdx - i), base_filled: '0', quote_filled: '0', fee: '0', order: { appendix: '1' } })),
      txs: Array.from({ length: count }, (_, i) => ({ submission_idx: String(fromIdx - i), timestamp: String(startTime - i) })),
    });
    const idxs: (string | undefined)[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: any) => {
      const { matches } = JSON.parse(init.body);
      idxs.push(matches.idx);
      return respond(idxs.length === 1 ? page(10_000, 500, 50_000) : page(9_500, 500, 49_500));
    });
    const result = await fetchFillsSince(INK_SEPOLIA, '0xabc', 49_300);
    expect(idxs).toEqual([undefined, '9500']);
    expect(result.truncated).toBe(false);
    expect(result.fills).toHaveLength(701); // 500 from page one, then 49,500 down to 49,300 inclusive
    expect(result.fills.every((f) => f.timestamp >= 49_300)).toBe(true);
  });

  it('reports truncation when the page limit runs out first', async () => {
    vi.stubGlobal('fetch', async () =>
      respond({
        matches: Array.from({ length: 500 }, (_, i) => ({ digest: '0x', submission_idx: String(1_000_000 - i), base_filled: '0', quote_filled: '0', fee: '0' })),
        txs: Array.from({ length: 500 }, (_, i) => ({ submission_idx: String(1_000_000 - i), timestamp: '99999' })),
      })
    );
    expect((await fetchFillsSince(INK_SEPOLIA, '0xabc', 0, 2)).truncated).toBe(true);
  });
});
