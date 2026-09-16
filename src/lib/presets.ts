/**
 * Quick strategies: ready-made settings for the dashboard's tools. A preset only fills in a form; the trader still sees
 * the preview and risk checks and signs every order. Prices are offsets from the market, so a preset works on any market.
 */

export type PresetTool = 'plan' | 'ladder' | 'twap';

interface Base {
  id: string;
  title: string;
  summary: string;
  tool: PresetTool;
}

export interface PlanPreset extends Base {
  tool: 'plan';
  side: 'long' | 'short';
  /** The most to lose if the stop-loss is hit, in USD. */
  riskUsd: number;
  /** How far past the market the entry rests, in percent. */
  entryOffsetPercent: number;
  stopLossPercent: number;
  takeProfitPercent: number;
}

export interface LadderPreset extends Base {
  tool: 'ladder';
  side: 'long' | 'short';
  totalUsd: number;
  rungs: number;
  nearOffsetPercent: number;
  farOffsetPercent: number;
  distribution: 'even' | 'weighted';
  stopLossPercent: number;
  takeProfits: { percent: number; share: number }[];
}

export interface TwapPreset extends Base {
  tool: 'twap';
  mode: 'twap' | 'dca';
  side: 'buy' | 'sell';
  totalUsd: number;
  /** TWAP only */
  executions?: number;
  minutes?: number;
  /** DCA only */
  intervalSeconds?: number;
  hours?: number;
  slippagePercent: number;
}

export type Preset = PlanPreset | LadderPreset | TwapPreset;

export const PRESETS: Preset[] = [
  {
    id: 'dip-ladder',
    title: 'Buy the dip',
    summary: 'Four buys 1–6% below the price, more size lower down, one stop and three profit targets.',
    tool: 'ladder',
    side: 'long',
    totalUsd: 1000,
    rungs: 4,
    nearOffsetPercent: 1,
    farOffsetPercent: 6,
    distribution: 'weighted',
    stopLossPercent: 5,
    takeProfits: [
      { percent: 4, share: 50 },
      { percent: 8, share: 30 },
      { percent: 12, share: 20 },
    ],
  },
  {
    id: 'risk-plan',
    title: 'Risk $25, aim for 2×',
    summary: 'A long entry just below the price, sized so the stop loses about $25, with a target twice as far.',
    tool: 'plan',
    side: 'long',
    riskUsd: 25,
    entryOffsetPercent: 1,
    stopLossPercent: 3,
    takeProfitPercent: 6,
  },
  {
    id: 'rally-short',
    title: 'Sell the rally',
    summary: 'Three short entries 1–5% above the price, a stop above them and two targets below.',
    tool: 'ladder',
    side: 'short',
    totalUsd: 900,
    rungs: 3,
    nearOffsetPercent: 1,
    farOffsetPercent: 5,
    distribution: 'even',
    stopLossPercent: 5,
    takeProfits: [
      { percent: 4, share: 60 },
      { percent: 8, share: 40 },
    ],
  },
  {
    id: 'daily-dca',
    title: 'Daily DCA',
    summary: 'Buy $1,000 spread over the next 24 hours, every 4 hours, with a reminder to renew.',
    tool: 'twap',
    mode: 'dca',
    side: 'buy',
    totalUsd: 1000,
    intervalSeconds: 14400,
    hours: 24,
    slippagePercent: 0.5,
  },
  {
    id: 'hour-twap',
    title: 'Enter quietly over an hour',
    summary: 'Buy $2,000 in 10 slices over 60 minutes to avoid moving the price.',
    tool: 'twap',
    mode: 'twap',
    side: 'buy',
    totalUsd: 2000,
    executions: 10,
    minutes: 60,
    slippagePercent: 0.5,
  },
];

/** Pure: a price `offsetPercent` away from the market, on the side where a limit entry rests (below for longs). */
export function restingPrice(side: 'long' | 'short', bid: number, ask: number, offsetPercent: number) {
  return side === 'long' ? bid * (1 - offsetPercent / 100) : ask * (1 + offsetPercent / 100);
}
