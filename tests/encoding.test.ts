import { describe, expect, it } from 'vitest';
import {
  buildNonce,
  describeTwap,
  encodeAppendix,
  encodeTwapValue,
  formatPrice,
  fromX18,
  incrementDecimals,
  isReduceOnly,
  OrderType,
  priceInputValue,
  roundToIncrement,
  subaccountToBytes32,
  toX18,
  verifyingContractForProduct,
  type TriggerOrderEntry,
} from '../src/lib/nado';

describe('order appendix', () => {
  it('always carries version 1 and no builder when none is configured', () => {
    expect(encodeAppendix()).toBe(1n);
  });

  it('packs order type, reduce-only and trigger type into their bits', () => {
    expect(encodeAppendix({ orderType: OrderType.IOC })).toBe(1n | (1n << 9n));
    expect(encodeAppendix({ reduceOnly: true })).toBe(1n | (1n << 11n));
    expect(encodeAppendix({ triggerType: 1 })).toBe(1n | (1n << 12n));
    expect(encodeAppendix({ triggerType: 2, orderType: OrderType.IOC })).toBe(1n | (1n << 9n) | (2n << 12n));
  });

  it('puts the value field in the top 64 bits', () => {
    expect(encodeAppendix({ value: 5n })).toBe(1n | (5n << 64n));
  });

  it('matches an appendix Nado recorded for a real IOC reduce-only close', () => {
    // Appendix of a filled testnet order, as returned by Nado's archive.
    expect(encodeAppendix({ orderType: OrderType.IOC, reduceOnly: true })).toBe(2561n);
    expect(isReduceOnly('2561')).toBe(true);
    expect(isReduceOnly('513')).toBe(false);
  });
});

describe('TWAP value field', () => {
  it('stores executions in the high 32 bits and slippage x 1e6 in the low 32 bits', () => {
    expect(encodeTwapValue(5, 0.005)).toBe((5n << 32n) | 5000n);
  });

  it('round-trips through describeTwap', () => {
    const appendix = encodeAppendix({ orderType: OrderType.IOC, triggerType: 2, value: encodeTwapValue(4, 0.01) });
    const entry = {
      order: { order: { appendix: appendix.toString() }, trigger: { time_trigger: { interval: 600 } } },
    } as unknown as TriggerOrderEntry;
    expect(describeTwap(entry)).toEqual({ executions: 4, slippagePercent: 1, intervalSeconds: 600 });
  });
});

describe('rounding to a market increment', () => {
  const step = 1000n;
  it('rounds down, up and to nearest', () => {
    expect(roundToIncrement(1_234_567n, step, 'down')).toBe(1_234_000n);
    expect(roundToIncrement(1_234_567n, step, 'up')).toBe(1_235_000n);
    expect(roundToIncrement(1_234_567n, step, 'nearest')).toBe(1_235_000n);
    expect(roundToIncrement(1_234_499n, step, 'nearest')).toBe(1_234_000n);
  });

  it('leaves exact multiples alone', () => {
    for (const mode of ['down', 'up', 'nearest'] as const) expect(roundToIncrement(5_000n, step, mode)).toBe(5_000n);
  });

  it('treats down and up as floor and ceiling for negative values', () => {
    expect(roundToIncrement(-1_234_567n, step, 'down')).toBe(-1_235_000n);
    expect(roundToIncrement(-1_234_567n, step, 'up')).toBe(-1_234_000n);
  });

  it('ignores a zero increment', () => {
    expect(roundToIncrement(123n, 0n, 'down')).toBe(123n);
  });
});

describe('x18 conversion', () => {
  it('converts decimals without float drift', () => {
    expect(toX18(0.1)).toBe(100_000_000_000_000_000n);
    expect(toX18(75452.98)).toBe(75_452_980_000_000_000_000_000n);
    expect(fromX18('1500000000000000000')).toBe(1.5);
    expect(fromX18(-(10n ** 16n))).toBe(-0.01);
  });
});

describe('price display', () => {
  it('reads the decimal places of a tick or lot size', () => {
    expect(incrementDecimals(10n ** 18n)).toBe(0);
    expect(incrementDecimals(10n ** 16n)).toBe(2);
    expect(incrementDecimals(5n * 10n ** 13n)).toBe(5);
    expect(incrementDecimals('1000000000000')).toBe(6);
    expect(incrementDecimals(0n)).toBe(2);
  });

  it("formats prices at the market's precision", () => {
    expect(formatPrice(75452.98, 10n ** 18n)).toBe('$75,453');
    expect(formatPrice(0.0123456, 10n ** 12n)).toBe('$0.012346');
    expect(formatPrice(3.14159, 10n ** 16n)).toBe('$3.14');
    expect(formatPrice(-2.5, 10n ** 16n)).toBe('-$2.5');
  });

  it('never rounds a sub-dollar price to $0 without a tick', () => {
    expect(formatPrice(0.00042)).toBe('$0.00042');
    expect(formatPrice(1234.5678)).toBe('$1,234.57');
  });

  it('writes input values at tick precision without grouping', () => {
    expect(priceInputValue(0.01234567, 10n ** 13n)).toBe('0.01235');
    expect(priceInputValue(75452.98, 10n ** 18n)).toBe('75453');
  });
});

describe('identifiers', () => {
  it('builds a default subaccount from an address', () => {
    expect(subaccountToBytes32('0x9319492E613205a4409b939434e3237c210a90f0')).toBe(
      '0x9319492e613205a4409b939434e3237c210a90f064656661756c740000000000'
    );
  });

  it('signs orders against address(productId)', () => {
    expect(verifyingContractForProduct(2)).toBe('0x0000000000000000000000000000000000000002');
  });

  it('encodes the receive deadline in the top bits of the nonce', () => {
    const before = Date.now();
    const nonce = buildNonce(60_000);
    const recvTime = Number(nonce >> 20n);
    expect(recvTime).toBeGreaterThanOrEqual(before + 60_000);
    expect(recvTime).toBeLessThanOrEqual(Date.now() + 60_000);
  });
});
