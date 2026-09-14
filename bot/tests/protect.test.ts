import { planProtection, decideProtection } from '../src/trading/protect';
import { exceedsPositionCap } from '../src/index';
import { encodeAppendix } from '../src/nado/appendix';
import { roundToIncrement } from '../src/nado/ticks';
import type { TriggerOrderEntry } from '../src/trading/trigger';

const X18 = 10n ** 18n;
const TICK = X18; // BTC-PERP trades in $1 increments
const long = (btc: number, entry: number) => ({
  productId: 2,
  amount: BigInt(Math.round(btc * 1e6)) * 10n ** 12n,
  avgEntryPriceX18: BigInt(entry) * X18,
});

const trigger = (amount: bigint, priceX18: bigint, reduceOnly = true): TriggerOrderEntry => ({
  order: {
    order: { sender: '0x', priceX18: priceX18.toString(), amount: amount.toString(), expiration: '0', nonce: '0', appendix: encodeAppendix({ reduceOnly }).toString() },
    product_id: 2,
    trigger: {},
    digest: '0x' + Math.random().toString(16).slice(2).padEnd(64, '0'),
  },
  status: 'waiting_price',
  placed_at: 0,
  updated_at: 0,
});

describe('planProtection', () => {
  it('puts the stop below and take-profit above entry for a long', () => {
    const plan = planProtection(long(0.001, 80000), 0.05, 0.1, TICK);
    expect(plan.isLong).toBe(true);
    expect(plan.exitAmount).toBe(-(10n ** 15n));
    expect(plan.stopPrice).toBe(76000n * X18);
    expect(plan.takeProfitPrice).toBe(88000n * X18);
    expect(plan.stopLimit < plan.stopPrice).toBe(true);
  });
});

describe('decideProtection', () => {
  const position = long(0.001, 80000);
  const plan = planProtection(position, 0.05, 0.1, TICK);
  const correctPair = () => [trigger(plan.exitAmount, plan.stopLimit), trigger(plan.exitAmount, plan.takeProfitLimit)];

  it('places protection on an unprotected position', () => {
    expect(decideProtection(position, [], plan)).toBe('place');
  });

  it('leaves a correctly sized and priced pair alone', () => {
    expect(decideProtection(position, correctPair(), plan)).toBe('none');
  });

  it('replaces protection when the position grew after another buy', () => {
    const grown = long(0.002, 80000);
    expect(decideProtection(grown, correctPair(), planProtection(grown, 0.05, 0.1, TICK))).toBe('replace');
  });

  it('replaces protection when the average entry moved', () => {
    const moved = long(0.001, 78000);
    expect(decideProtection(moved, correctPair(), planProtection(moved, 0.05, 0.1, TICK))).toBe('replace');
  });

  it('replaces a half-placed pair', () => {
    expect(decideProtection(position, [correctPair()[0]], plan)).toBe('replace');
  });

  it('cleans up leftover orders once the position is closed', () => {
    expect(decideProtection(null, [correctPair()[1]], null)).toBe('cleanup');
  });

  it('ignores trigger orders the bot did not create (not reduce-only)', () => {
    const userEntry = trigger(10n ** 15n, 70000n * X18, false);
    expect(decideProtection(null, [userEntry], null)).toBe('none');
    expect(decideProtection(position, [...correctPair(), userEntry], plan)).toBe('none');
  });
});

describe('exceedsPositionCap', () => {
  it('allows buys up to the cap and blocks the one that would cross it', () => {
    expect(exceedsPositionCap(0, 0.001, 0.005)).toBe(false);
    expect(exceedsPositionCap(0.004, 0.001, 0.005)).toBe(false);
    expect(exceedsPositionCap(0.005, 0.001, 0.005)).toBe(true);
  });
});

describe('roundToIncrement', () => {
  it('rounds prices onto the tick grid in the requested direction', () => {
    const p = 74743588293402690941038n; // the exact price Nado rejected in the live test
    expect(roundToIncrement(p, TICK, 'down')).toBe(74743n * X18);
    expect(roundToIncrement(p, TICK, 'up')).toBe(74744n * X18);
    expect(roundToIncrement(p, TICK, 'nearest')).toBe(74744n * X18);
    expect(roundToIncrement(74743n * X18, TICK, 'up')).toBe(74743n * X18);
  });

  it('treats up/down as signed for negative sizes', () => {
    const lot = 5n * 10n ** 13n; // 0.00005 BTC
    expect(roundToIncrement(-1234n * 10n ** 12n, lot, 'down')).toBe(-1250n * 10n ** 12n);
    expect(roundToIncrement(-1234n * 10n ** 12n, lot, 'up')).toBe(-1200n * 10n ** 12n);
  });

  it('produces tick-aligned protection prices', () => {
    const plan = planProtection({ productId: 2, amount: 10n ** 15n, avgEntryPriceX18: 78674123456789000000000n }, 0.05, 0.1, TICK);
    for (const price of [plan.stopPrice, plan.takeProfitPrice, plan.stopLimit, plan.takeProfitLimit]) {
      expect(price % TICK).toBe(0n);
    }
  });
});
