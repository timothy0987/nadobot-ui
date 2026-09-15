import { describe, expect, it } from 'vitest';
import {
  accountLeverage,
  assessTradeRisk,
  fromX18,
  liquidationPrice,
  maxLeverage,
  parseAccountRisk,
  projectRisk,
  repriceAccount,
  sizeForRisk,
  type AccountRisk,
} from '../src/lib/nado';
import fixture from './fixtures/nado-testnet.json';

// Real Nado testnet data: an account's health, plus Nado's own apply_delta simulation of four hypothetical trades.
const account = parseAccountRisk(fixture.subaccountInfo)!;
const BTC = 2;

describe('reading account risk', () => {
  it('takes equity and margins from Nado health', () => {
    const [initial, maintenance, unweighted] = fixture.subaccountInfo.healths.map((h) => fromX18(h.health));
    expect(account.availableMargin).toBe(initial);
    expect(account.maintenanceMargin).toBe(maintenance);
    expect(account.equity).toBe(unweighted);
    expect(account.weights[BTC].price).toBeGreaterThan(0);
  });

  it('returns null for an account without a deposit', () => {
    expect(parseAccountRisk({ exists: false })).toBeNull();
  });
});

describe('projecting a trade', () => {
  it.each(fixture.simulations.map((s, i) => [i, s] as const))("matches Nado's own simulation (trade %i)", (_, sim) => {
    const projected = projectRisk(account, [{ productId: sim.productId, amount: fromX18(sim.amount_x18), price: fromX18(sim.price_x18) }]);
    const [initial, maintenance, unweighted] = sim.healths.map((h) => fromX18(h.health));
    expect(projected.availableMargin).toBeCloseTo(initial, 6);
    expect(projected.maintenanceMargin).toBeCloseTo(maintenance, 6);
    expect(projected.equity).toBeCloseTo(unweighted, 6);
  });

  it('applies several fills in order', () => {
    const [a, b] = fixture.simulations;
    const once = projectRisk(account, [
      { productId: a.productId, amount: fromX18(a.amount_x18), price: fromX18(a.price_x18) },
      { productId: b.productId, amount: fromX18(b.amount_x18), price: fromX18(b.price_x18) },
    ]);
    const stepwise = projectRisk(projectRisk(account, [{ productId: a.productId, amount: fromX18(a.amount_x18), price: fromX18(a.price_x18) }]), [
      { productId: b.productId, amount: fromX18(b.amount_x18), price: fromX18(b.price_x18) },
    ]);
    expect(once.availableMargin).toBeCloseTo(stepwise.availableMargin, 9);
    expect(once.perps[BTC].amount).toBeCloseTo(stepwise.perps[BTC].amount, 12);
  });

  it('does not mutate the original account', () => {
    const before = JSON.stringify(account);
    projectRisk(account, [{ productId: BTC, amount: 0.5, price: 70000 }]);
    repriceAccount(account, BTC, 60000);
    expect(JSON.stringify(account)).toBe(before);
  });
});

describe('liquidation price', () => {
  const long = projectRisk(account, [{ productId: BTC, amount: 0.02, price: account.weights[BTC].price }]);

  it('is where maintenance health reaches zero', () => {
    const liq = liquidationPrice(long, BTC)!;
    expect(liq).toBeLessThan(long.weights[BTC].price);
    expect(repriceAccount(long, BTC, liq).maintenanceMargin).toBeCloseTo(0, 6);
  });

  it('does not depend on the price the account is valued at', () => {
    const fills = [{ productId: BTC, amount: 0.004, price: account.weights[BTC].price * 0.97 }];
    const atMark = liquidationPrice(projectRisk(account, fills), BTC)!;
    const atFill = liquidationPrice(projectRisk(repriceAccount(account, BTC, fills[0].price), fills), BTC)!;
    expect(atFill).toBeCloseTo(atMark, 6);
  });

  it('sits above the price for a short', () => {
    const short = projectRisk(account, [{ productId: BTC, amount: -0.03, price: account.weights[BTC].price }]);
    expect(liquidationPrice(short, BTC)!).toBeGreaterThan(short.weights[BTC].price);
  });

  it('is null without a position, or for a long that stays solvent to $0', () => {
    const flat: AccountRisk = { ...account, perps: {} };
    expect(liquidationPrice(flat, BTC)).toBeNull();
    const rich: AccountRisk = { ...account, maintenanceMargin: 1_000_000, perps: { [BTC]: { amount: 0.001, vQuote: -70 } } };
    expect(liquidationPrice(rich, BTC)).toBeNull();
  });
});

describe('trade risk checks', () => {
  const mark = account.weights[BTC].price;
  const fills = (amount: number, price = mark) => [{ productId: BTC, amount, price }];

  it('passes a small trade with a sensible stop', () => {
    const risk = assessTradeRisk(account, { productId: BTC, fills: fills(0.001, mark * 0.98), stopPrice: mark * 0.93 });
    expect(risk.errors).toEqual([]);
    expect(risk.marginUsedPercent).toBeGreaterThan(0);
    expect(risk.marginUsedPercent).toBeLessThan(100);
  });

  it('blocks a trade the account does not have margin for, with one clear error', () => {
    const risk = assessTradeRisk(account, { productId: BTC, fills: fills(1), stopPrice: mark * 0.95 });
    expect(risk.after.availableMargin).toBeLessThan(0);
    expect(risk.errors).toHaveLength(1);
    expect(risk.errors[0]).toMatch(/^Not enough margin/);
  });

  it('blocks a stop-loss beyond the liquidation price', () => {
    const probe = assessTradeRisk(account, { productId: BTC, fills: fills(0.02) });
    const risk = assessTradeRisk(account, { productId: BTC, fills: fills(0.02), stopPrice: probe.liquidationPrice! - 1 });
    expect(risk.errors.join()).toMatch(/stop-loss .* estimated liquidation price/);
  });

  it('warns about high leverage', () => {
    const current = account.perps[BTC]?.amount ?? 0;
    const target = (10.5 * account.equity) / mark - current; // enough to push account leverage past 10x
    const risk = assessTradeRisk(account, { productId: BTC, fills: fills(target) });
    expect(risk.errors).toEqual([]);
    expect(risk.leverage).toBeGreaterThanOrEqual(10);
    expect(risk.warnings.join()).toMatch(/leverage would be/);
  });

  it('judges margin at the fill price, not today’s price', () => {
    const below = mark * 0.9;
    const risk = assessTradeRisk(account, { productId: BTC, fills: fills(0.005, below) });
    const naive = projectRisk(account, fills(0.005, below));
    expect(risk.after.availableMargin).toBeLessThan(naive.availableMargin);
  });
});

describe('sizing helpers', () => {
  it('sizes a position by the amount at risk, rounded down to the lot size', () => {
    expect(sizeForRisk(50, 75000, 71250, 5n * 10n ** 13n)).toBe(0.0133);
    expect(sizeForRisk(50, 75000, 75000, 5n * 10n ** 13n)).toBe(0);
    expect(sizeForRisk(0, 75000, 71250, 5n * 10n ** 13n)).toBe(0);
  });

  it('derives max leverage from the initial weight', () => {
    expect(maxLeverage({ price: 1, longInitial: 0.95, shortInitial: 1.05, longMaintenance: 0.97, shortMaintenance: 1.03 })).toBeCloseTo(20, 9);
    expect(maxLeverage(account.weights[BTC])).toBeGreaterThan(1);
  });

  it('reports zero leverage with no positions', () => {
    expect(accountLeverage({ ...account, perps: {} })).toBe(0);
  });
});
