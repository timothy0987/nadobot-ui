import { describe, expect, it } from 'vitest';
import { planLadder, planTwap, priceTradePlan, sizeForRisk, fromX18 } from '../src/lib/nado';
import { PRESETS, restingPrice, type LadderPreset, type PlanPreset, type TwapPreset } from '../src/lib/presets';
import fixture from './fixtures/nado-testnet.json';

// Real market parameters recorded from Nado: a $1-tick market (BTC), a $0.1-tick one (ETH) and a small-price one (TON).
const markets = [
  { name: 'BTC-PERP', bid: 75000, ask: 75001 },
  { name: 'ETH-PERP', bid: 2400.1, ask: 2400.2 },
  { name: 'TON-PERP', bid: 1.3422, ask: 1.3423 },
].map((m) => {
  const p = (fixture.products as Record<string, { product_id: number; price_increment_x18: string; size_increment: string; min_size: string }>)[m.name];
  return { ...m, productId: p.product_id, priceIncrementX18: BigInt(p.price_increment_x18), sizeIncrementX18: BigInt(p.size_increment), minOrderValueX18: BigInt(p.min_size) };
});
const SENDER = `0x${'00'.repeat(32)}` as const;

describe('quick strategies', () => {
  it('have unique ids and a title and summary', () => {
    expect(new Set(PRESETS.map((p) => p.id)).size).toBe(PRESETS.length);
    for (const p of PRESETS) expect(p.title.length && p.summary.length).toBeTruthy();
  });

  // The promise of a preset: tapping it never fills in something Nado would reject or the dashboard would block.
  for (const m of markets) {
    describe(`on ${m.name}`, () => {
      it.each(PRESETS.filter((p): p is LadderPreset => p.tool === 'ladder').map((p) => [p.title, p] as const))('%s makes a valid ladder', (_, p) => {
        const near = restingPrice(p.side, m.bid, m.ask, p.nearOffsetPercent);
        const far = restingPrice(p.side, m.bid, m.ask, p.farOffsetPercent);
        const n = p.rungs;
        const weights = Array.from({ length: n }, (_, i) => (p.distribution === 'weighted' ? i + 1 : 1));
        const avg = weights.reduce((a, w, i) => a + w * (near + ((far - near) * i) / (n - 1)), 0) / weights.reduce((a, b) => a + b, 0);
        const plan = planLadder({
          productId: m.productId,
          sender: SENDER,
          side: p.side,
          totalSize: p.totalUsd / avg,
          rungs: n,
          nearPrice: near,
          farPrice: far,
          distribution: p.distribution,
          stopLossPercent: p.stopLossPercent,
          takeProfits: p.takeProfits.map((t) => ({ percent: t.percent, sharePercent: t.share })),
          expiresInDays: 7,
          bid: m.bid,
          ask: m.ask,
          priceIncrementX18: m.priceIncrementX18,
          sizeIncrementX18: m.sizeIncrementX18,
          minOrderValueX18: m.minOrderValueX18,
        });
        expect(plan.errors).toEqual([]);
      });

      it.each(PRESETS.filter((p): p is PlanPreset => p.tool === 'plan').map((p) => [p.title, p] as const))('%s makes a valid trade plan', (_, p) => {
        const entry = restingPrice(p.side, m.bid, m.ask, p.entryOffsetPercent);
        const stop = entry * (p.side === 'long' ? 1 - p.stopLossPercent / 100 : 1 + p.stopLossPercent / 100);
        const size = sizeForRisk(p.riskUsd, entry, stop, m.sizeIncrementX18);
        const priced = priceTradePlan({
          productId: m.productId,
          sender: SENDER,
          side: p.side,
          size,
          entryPrice: entry,
          stopLossPercent: p.stopLossPercent,
          takeProfitPercent: p.takeProfitPercent,
          expiresInDays: 7,
          priceIncrementX18: m.priceIncrementX18,
          sizeIncrementX18: m.sizeIncrementX18,
        });
        const value = Math.abs(fromX18(priced.amount)) * fromX18(priced.entryX18);
        expect(value).toBeGreaterThanOrEqual(fromX18(m.minOrderValueX18)); // clears the market minimum
        expect(p.side === 'long' ? fromX18(priced.entryX18) < m.ask : fromX18(priced.entryX18) > m.bid).toBe(true); // rests, doesn't fill at once
        expect(p.takeProfitPercent / p.stopLossPercent).toBeGreaterThanOrEqual(2);
      });

      it.each(PRESETS.filter((p): p is TwapPreset => p.tool === 'twap').map((p) => [p.title, p] as const))('%s makes a valid schedule', (_, p) => {
        const market = p.side === 'buy' ? m.ask : m.bid;
        const executions = p.mode === 'dca' ? Math.floor((p.hours! * 3600) / p.intervalSeconds!) + 1 : p.executions!;
        const intervalSeconds = p.mode === 'dca' ? p.intervalSeconds! : Math.round((p.minutes! * 60) / (p.executions! - 1));
        const plan = planTwap(
          {
            productId: m.productId,
            sender: SENDER,
            side: p.side,
            totalSize: p.totalUsd / market,
            executions,
            intervalSeconds,
            slippagePercent: p.slippagePercent,
            limitPrice: market * (p.side === 'buy' ? 1.03 : 0.97),
            marketPrice: market,
            priceIncrementX18: m.priceIncrementX18,
            sizeIncrementX18: m.sizeIncrementX18,
            minOrderValueX18: m.minOrderValueX18,
          },
          1_790_000_000
        );
        expect(plan.errors).toEqual([]);
      });
    });
  }
});
