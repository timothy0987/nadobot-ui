import { describe, expect, it } from 'vitest';
import { dayStats, fillCandleGaps, parseCandles, priceTicks, type Candle } from '../src/lib/chart';

const x18 = (n: number) => (BigInt(Math.round(n * 1e6)) * 10n ** 12n).toString();
const H = 3600;
const candle = (time: number, o: number, h: number, l: number, c: number, v = 1): Candle => ({ time, open: o, high: h, low: l, close: c, volume: v });

describe('candles from Nado', () => {
  it('parse prices and volume and sort oldest first', () => {
    const json = {
      candlesticks: [
        { timestamp: '7200', open_x18: x18(101), high_x18: x18(105), low_x18: x18(100), close_x18: x18(104), volume: x18(2.5) },
        { timestamp: '3600', open_x18: x18(100), high_x18: x18(102), low_x18: x18(99), close_x18: x18(101), volume: x18(1) },
      ],
    };
    expect(parseCandles(json)).toEqual([candle(3600, 100, 102, 99, 101, 1), candle(7200, 101, 105, 100, 104, 2.5)]);
    expect(parseCandles({})).toEqual([]);
  });
});

describe('filling quiet periods', () => {
  it('adds flat candles at the previous close so time stays even', () => {
    const filled = fillCandleGaps([candle(10 * H, 100, 110, 95, 105), candle(13 * H, 106, 108, 104, 107)], H, 10, 13 * H + 100);
    expect(filled.map((c) => c.time)).toEqual([10, 11, 12, 13].map((h) => h * H));
    expect(filled[1]).toEqual(candle(11 * H, 105, 105, 105, 105, 0));
    expect(filled[2].close).toBe(105);
  });

  it('extends to the current period and keeps only the last `count` candles', () => {
    const candles = Array.from({ length: 10 }, (_, i) => candle(i * H, 100 + i, 101 + i, 99 + i, 100.5 + i));
    const filled = fillCandleGaps(candles, H, 4, 12 * H + 5);
    expect(filled.map((c) => c.time / H)).toEqual([9, 10, 11, 12]);
    expect(filled[1]).toEqual(candle(10 * H, 109.5, 109.5, 109.5, 109.5, 0)); // carries the close of the last real candle
  });

  it('starts an early gap from the last close before the window', () => {
    const filled = fillCandleGaps([candle(0, 50, 55, 45, 52), candle(5 * H, 60, 61, 59, 60)], H, 3, 5 * H);
    expect(filled.map((c) => c.time / H)).toEqual([3, 4, 5]);
    expect(filled[0].close).toBe(52);
  });

  it('returns nothing without data', () => {
    expect(fillCandleGaps([], H, 10, 100 * H)).toEqual([]);
  });
});

describe('24-hour stats', () => {
  const now = 100 * H;
  const hourly = Array.from({ length: 30 }, (_, i) => candle((71 + i) * H, 100 + i, 102 + i, 99 + i, 101 + i, 2));

  it('uses only the last day for change, range and volume', () => {
    const s = dayStats(hourly, now)!;
    const day = hourly.filter((c) => c.time >= now - 86400 - H);
    expect(s.changePercent).toBeCloseTo(((day[day.length - 1].close - day[0].open) / day[0].open) * 100, 9);
    expect(s.high).toBe(Math.max(...day.map((c) => c.high)));
    expect(s.low).toBe(Math.min(...day.map((c) => c.low)));
    expect(s.volumeUsd).toBeCloseTo(day.reduce((a, c) => a + 2 * c.close, 0), 6);
  });

  it('is null without recent candles', () => {
    expect(dayStats([], now)).toBeNull();
  });
});

describe('price axis', () => {
  it('picks round steps inside the range', () => {
    expect(priceTicks(74120, 76880)).toEqual([74500, 75000, 75500, 76000, 76500]);
    expect(priceTicks(1.312, 1.347)).toEqual([1.315, 1.32, 1.325, 1.33, 1.335, 1.34, 1.345]);
  });

  it('copes with a flat range', () => {
    expect(priceTicks(100, 100)).toEqual([100]);
  });
});
