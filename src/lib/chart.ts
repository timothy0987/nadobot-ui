import { fromX18, type NadoNetwork } from './nado';

export interface Candle {
  /** Unix seconds at the start of the candle. */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  /** Base asset traded in the candle. */
  volume: number;
}

/** Timeframes the chart offers: candle size and how many to show. */
export const TIMEFRAMES = [
  { id: '15m', label: '15m', granularity: 900, candles: 96 },
  { id: '1h', label: '1H', granularity: 3600, candles: 168 },
  { id: '4h', label: '4H', granularity: 14400, candles: 180 },
  { id: '1d', label: '1D', granularity: 86400, candles: 180 },
] as const;
export type TimeframeId = (typeof TIMEFRAMES)[number]['id'];

/** Pure: Nado's candlesticks response, oldest first. */
export function parseCandles(json: any): Candle[] {
  return (json?.candlesticks ?? [])
    .map((c: any) => ({
      time: Number(c.timestamp),
      open: fromX18(c.open_x18),
      high: fromX18(c.high_x18),
      low: fromX18(c.low_x18),
      close: fromX18(c.close_x18),
      volume: fromX18(c.volume ?? '0'),
    }))
    .sort((a: Candle, b: Candle) => a.time - b.time);
}

/**
 * Pure: Nado only records a candle when something trades, so quiet periods are missing. Fill each gap with a flat candle
 * at the previous close so the chart's time axis stays even, and keep the most recent `count` candles up to `now`.
 */
export function fillCandleGaps(candles: Candle[], granularity: number, count: number, nowSeconds: number): Candle[] {
  if (candles.length === 0) return [];
  const byTime = new Map(candles.map((c) => [c.time, c]));
  const last = Math.floor(nowSeconds / granularity) * granularity;
  const first = Math.max(last - (count - 1) * granularity, candles[0].time);
  // Carry the last close from before the window, so an early gap starts at the right price.
  let previous = [...candles].reverse().find((c) => c.time < first)?.close ?? candles[0].open;
  const filled: Candle[] = [];
  for (let t = first; t <= last; t += granularity) {
    const candle = byTime.get(t);
    if (candle) {
      filled.push(candle);
      previous = candle.close;
    } else {
      filled.push({ time: t, open: previous, high: previous, low: previous, close: previous, volume: 0 });
    }
  }
  return filled;
}

export interface MarketStats {
  changePercent: number;
  high: number;
  low: number;
  /** Traded value over the window, in USD, estimated from each candle's volume at its close. */
  volumeUsd: number;
}

/** Pure: 24-hour change, range and volume from hourly candles covering (at least) the last day. */
export function dayStats(hourly: Candle[], nowSeconds: number): MarketStats | null {
  const since = nowSeconds - 86400;
  const day = hourly.filter((c) => c.time >= since - 3600);
  if (day.length === 0) return null;
  const open = day[0].open;
  const close = day[day.length - 1].close;
  return {
    changePercent: open > 0 ? ((close - open) / open) * 100 : 0,
    high: Math.max(...day.map((c) => c.high)),
    low: Math.min(...day.map((c) => c.low)),
    volumeUsd: day.reduce((sum, c) => sum + c.volume * c.close, 0),
  };
}

async function archive(network: NadoNetwork, body: object) {
  const res = await fetch(network.archiveUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept-Encoding': 'gzip, br, deflate' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error);
  return json;
}

/** Candles from Nado's indexer, oldest first. Public data, no signature. */
export async function fetchCandles(network: NadoNetwork, productId: number, granularity: number, limit: number): Promise<Candle[]> {
  return parseCandles(await archive(network, { candlesticks: { product_id: productId, granularity, limit: Math.min(limit, 500) } }));
}

/** Nado's funding rate for a perp as a 24-hour fraction (0.001 = 0.1% a day). Positive means longs pay shorts. */
export async function fetchFundingRate(network: NadoNetwork, productId: number): Promise<number> {
  const json = await archive(network, { funding_rate: { product_id: productId } });
  return fromX18(json.funding_rate_x18 ?? '0');
}

/** Pure: a price axis with round steps covering [low, high], for gridlines and labels. */
export function priceTicks(low: number, high: number, target = 6): number[] {
  if (!(high > low)) return [low];
  const range = high - low;
  const magnitude = 10 ** Math.floor(Math.log10(range / target));
  // The round step whose label count lands closest to the target.
  const step = [1, 2, 2.5, 5, 10, 20]
    .map((m) => m * magnitude)
    .reduce((best, s) => (Math.abs(range / s - target) < Math.abs(range / best - target) ? s : best));
  const ticks: number[] = [];
  for (let v = Math.ceil(low / step) * step; v <= high + step * 1e-9; v += step) ticks.push(Number(v.toPrecision(12)));
  return ticks;
}
