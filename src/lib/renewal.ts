/** What the dashboard remembers about a TWAP or DCA it started, in this browser. */
export interface SavedSchedule {
  digest: string;
  chainId: number;
  sender: string;
  productId: number;
  symbol: string;
  mode: 'twap' | 'dca';
  side: 'buy' | 'sell';
  size: number;
  executions: number;
  intervalSeconds: number;
  createdAt: number;
}

/** DCA frequencies the form offers. */
export const DCA_INTERVAL_SECONDS = [900, 1800, 3600, 7200, 14400];

export interface RenewalDraft {
  side: 'buy' | 'sell';
  /** Same total size as last time, in the market's base asset. */
  amount: string;
  intervalSeconds: number;
  hours: string;
}

/**
 * Pure: form values to start the next DCA with the same settings as a finished one. Null when the schedule isn't a
 * DCA this browser started on this network and market, so the trader sets it up afresh instead.
 */
export function renewalDraft(saved: SavedSchedule[], digest: string, chainId: number, productId: number): RenewalDraft | null {
  const previous = saved.find((s) => s.digest.toLowerCase() === digest.toLowerCase());
  if (!previous || previous.mode !== 'dca' || previous.chainId !== chainId || previous.productId !== productId) return null;
  const intervalSeconds = DCA_INTERVAL_SECONDS.includes(previous.intervalSeconds) ? previous.intervalSeconds : 3600;
  const hours = Math.min(((previous.executions - 1) * previous.intervalSeconds) / 3600, 24);
  return { side: previous.side, amount: String(previous.size), intervalSeconds, hours: String(Math.max(Math.round(hours * 10) / 10, 1)) };
}

/** Pure: the reminder the bot needs to nudge this device when a DCA ends. */
export function reminderFor(p: {
  digest: string;
  chainId: number;
  productId: number;
  symbol: string;
  side: 'buy' | 'sell';
  size: number;
  durationSeconds: number;
  nowSeconds: number;
}) {
  return {
    digest: p.digest,
    chainId: p.chainId,
    productId: p.productId,
    symbol: p.symbol,
    side: p.side,
    size: p.size,
    hours: Math.max(p.durationSeconds / 3600, 1 / 60),
    endsAt: p.nowSeconds + p.durationSeconds,
  };
}
