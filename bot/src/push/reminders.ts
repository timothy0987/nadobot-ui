import { SUPPORTED_CHAIN_IDS } from './validate';

/** A reminder to renew a DCA schedule when Nado's 25-hour limit ends it. */
export interface ScheduleReminder {
  /** Digest of the TWAP order behind the schedule; also how the dashboard finds its settings to renew. */
  digest: string;
  chainId: number;
  productId: number;
  symbol: string;
  side: 'buy' | 'sell';
  /** Total base size of the schedule, for the notification text. */
  size: number;
  hours: number;
  /** Unix seconds when the last execution is due. */
  endsAt: number;
  createdAt: string;
}

export const MAX_REMINDERS_PER_SUBSCRIPTION = 20;
const SYMBOL = /^[A-Z0-9]{1,15}-PERP$/;
const DIGEST = /^0x[0-9a-f]{64}$/;
// Nado caps a schedule at 25 hours; a little slack for the dashboard's clock.
const MAX_AHEAD_SECONDS = 26 * 3600;

/** Pure: validates a reminder request from the dashboard. */
export function parseReminder(body: any, nowSeconds = Math.floor(Date.now() / 1000)): ScheduleReminder | { error: string } {
  const chainId = Number(body?.chainId);
  if (!SUPPORTED_CHAIN_IDS.includes(chainId)) return { error: 'Unsupported network' };
  const digest = String(body?.digest ?? '').toLowerCase();
  if (!DIGEST.test(digest)) return { error: 'Invalid schedule' };
  const productId = Number(body?.productId);
  const symbol = String(body?.symbol ?? '');
  if (!Number.isInteger(productId) || productId < 0 || productId > 100_000 || !SYMBOL.test(symbol)) return { error: 'Invalid market' };
  if (body?.side !== 'buy' && body?.side !== 'sell') return { error: 'Invalid side' };
  const size = Number(body?.size);
  const hours = Number(body?.hours);
  if (!Number.isFinite(size) || size <= 0 || !Number.isFinite(hours) || hours <= 0 || hours > 26) return { error: 'Invalid schedule' };
  const endsAt = Math.floor(Number(body?.endsAt));
  if (!Number.isFinite(endsAt) || endsAt < nowSeconds || endsAt > nowSeconds + MAX_AHEAD_SECONDS) return { error: 'Invalid end time' };
  return { digest, chainId, productId, symbol, side: body.side, size, hours, endsAt, createdAt: new Date(nowSeconds * 1000).toISOString() };
}

/** Pure: reminders whose schedule has ended, allowing a minute for the last execution to settle. */
export const dueReminders = (reminders: ScheduleReminder[], nowSeconds: number) => reminders.filter((r) => nowSeconds >= r.endsAt + 60);

export type ExecutionState = 'pending' | 'executed' | 'failed' | 'cancelled';

/** Pure: whether a finished schedule deserves a renewal nudge. A cancelled schedule was stopped on purpose, so it doesn't. */
export function shouldRemind(states: ExecutionState[]): boolean {
  if (states.length === 0) return true; // Nado no longer lists it: it ran its course.
  if (states.includes('pending')) return false; // still going; checked again later
  return !states.includes('cancelled');
}

/** Maps Nado's list_twap_executions statuses: a plain string while pending, an object once settled. */
export function executionState(status: unknown): ExecutionState {
  if (typeof status === 'string') return 'pending';
  const s = status as Record<string, unknown>;
  if (s && 'executed' in s) return 'executed';
  if (s && 'failed' in s) return 'failed';
  return 'cancelled';
}

export function describeReminder(r: ScheduleReminder) {
  const base = r.symbol.replace('-PERP', '');
  const hours = Number.isInteger(r.hours) ? r.hours : r.hours.toFixed(1);
  return `Your ${r.symbol} DCA (${r.side} ${r.size} ${base} over ${hours} h) has finished. Tap to start the next one.`;
}
