import fs from 'fs';
import path from 'path';
import { SUPPORTED_CHAIN_IDS } from './push/validate';

/**
 * Anonymous usage counts: which tools get used, on which network, and the value of orders placed through them. No wallet
 * address, IP, cookie or identifier is ever recorded, only a daily tally per event, so nothing can be tied to a person.
 */
export const EVENT_NAMES = [
  'wallet_connected',
  'market_order',
  'plan_created',
  'ladder_placed',
  'twap_started',
  'dca_started',
  'position_protected',
  'position_closed',
  'exit_moved',
  'alert_set',
  'dca_reminder_set',
  'card_shared',
] as const;
export type EventName = (typeof EVENT_NAMES)[number];

export interface UsageEvent {
  name: EventName;
  chainId: number;
  /** USD value of the orders involved, when there are any. */
  valueUsd: number;
}

interface Tally {
  count: number;
  valueUsd: number;
}

/** day (YYYY-MM-DD, UTC) -> chainId -> event -> tally */
export type UsageData = Record<string, Record<string, Partial<Record<EventName, Tally>>>>;

const KEEP_DAYS = 180;
const MAX_VALUE_USD = 1e9;

/** Pure: validates an event from the dashboard. Anything unexpected is rejected rather than stored. */
export function parseEvent(body: any): UsageEvent | { error: string } {
  if (!EVENT_NAMES.includes(body?.name)) return { error: 'Unknown event' };
  const chainId = Number(body?.chainId);
  if (!SUPPORTED_CHAIN_IDS.includes(chainId)) return { error: 'Unsupported network' };
  const raw = body?.valueUsd ?? 0;
  const valueUsd = Number(raw);
  if (!Number.isFinite(valueUsd) || valueUsd < 0 || valueUsd > MAX_VALUE_USD) return { error: 'Invalid value' };
  return { name: body.name, chainId, valueUsd: Math.round(valueUsd * 100) / 100 };
}

/** Pure: adds one event to the tallies, and drops days older than the retention window. */
export function recordEvent(data: UsageData, event: UsageEvent, now = new Date()): UsageData {
  const day = now.toISOString().slice(0, 10);
  const chain = String(event.chainId);
  const tally = data[day]?.[chain]?.[event.name] ?? { count: 0, valueUsd: 0 };
  const next: UsageData = {
    ...data,
    [day]: {
      ...data[day],
      [chain]: { ...data[day]?.[chain], [event.name]: { count: tally.count + 1, valueUsd: Math.round((tally.valueUsd + event.valueUsd) * 100) / 100 } },
    },
  };
  const cutoff = new Date(now.getTime() - KEEP_DAYS * 86400_000).toISOString().slice(0, 10);
  for (const d of Object.keys(next)) if (d < cutoff) delete next[d];
  return next;
}

export interface UsageSummary {
  days: number;
  from: string;
  to: string;
  /** chainId -> event -> totals over the period */
  totals: Record<string, Partial<Record<EventName, Tally>>>;
  /** One entry per day in the period, oldest first: order value placed and events per network. */
  daily: { day: string; byChain: Record<string, { events: number; valueUsd: number }> }[];
}

/** Pure: totals and a daily series for the last `days` days, including days with no activity. */
export function summarizeUsage(data: UsageData, days: number, now = new Date()): UsageSummary {
  const span = Math.min(Math.max(Math.floor(days) || 30, 1), KEEP_DAYS);
  const dayKeys = Array.from({ length: span }, (_, i) => new Date(now.getTime() - (span - 1 - i) * 86400_000).toISOString().slice(0, 10));
  const totals: UsageSummary['totals'] = {};
  const daily = dayKeys.map((day) => {
    const byChain: Record<string, { events: number; valueUsd: number }> = {};
    for (const [chain, events] of Object.entries(data[day] ?? {})) {
      for (const [name, t] of Object.entries(events) as [EventName, Tally][]) {
        const total = (totals[chain] ??= {})[name] ?? { count: 0, valueUsd: 0 };
        totals[chain][name] = { count: total.count + t.count, valueUsd: Math.round((total.valueUsd + t.valueUsd) * 100) / 100 };
        const d = (byChain[chain] ??= { events: 0, valueUsd: 0 });
        d.events += t.count;
        d.valueUsd = Math.round((d.valueUsd + t.valueUsd) * 100) / 100;
      }
    }
    return { day, byChain };
  });
  return { days: span, from: dayKeys[0], to: dayKeys[dayKeys.length - 1], totals, daily };
}

/** File-backed tallies in DATA_DIR, written at most every few seconds so a burst of events costs one write. */
export class UsageStore {
  private data: UsageData = {};
  private readonly file: string;
  private timer: NodeJS.Timeout | null = null;

  constructor(dir: string) {
    this.file = path.join(dir, 'usage.json');
    fs.mkdirSync(dir, { recursive: true });
    try {
      if (fs.existsSync(this.file)) this.data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch (e: any) {
      console.error(`Could not read usage data, starting fresh: ${e.message}`);
    }
  }

  record(event: UsageEvent, now = new Date()) {
    this.data = recordEvent(this.data, event, now);
    if (!this.timer) this.timer = setTimeout(() => this.flush(), 5_000);
  }

  summary(days: number, now = new Date()) {
    return summarizeUsage(this.data, days, now);
  }

  flush() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    fs.renameSync(tmp, this.file);
  }
}
