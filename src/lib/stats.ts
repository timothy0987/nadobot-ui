import type { EventName } from './analytics';

/** The bot's GET /stats response. */
export interface StatsResponse {
  days: number;
  from: string;
  to: string;
  totals: Record<string, Partial<Record<EventName, { count: number; valueUsd: number }>>>;
  daily: { day: string; byChain: Record<string, { events: number; valueUsd: number }> }[];
}

export const TOOL_LABELS: Record<EventName, string> = {
  wallet_connected: 'Wallet sessions',
  plan_created: 'Trade plans',
  ladder_placed: 'Ladders',
  twap_started: 'TWAP schedules',
  dca_started: 'DCA schedules',
  position_protected: 'Positions protected',
  position_closed: 'Positions closed or trimmed',
  exit_moved: 'Stop-loss / take-profit moved',
  alert_set: 'Price alerts',
  dca_reminder_set: 'DCA renewal reminders',
  card_shared: 'PnL cards shared',
};

/** Events that place orders on Nado, whose value is order flow through Nadobot. */
const ORDER_EVENTS: EventName[] = ['plan_created', 'ladder_placed', 'twap_started', 'dca_started', 'position_closed'];

/** Pure: headline numbers, tool breakdown (most used first) and the daily series for one network. */
export function summarizeStats(data: StatsResponse, chainId: number) {
  const totals = data.totals[String(chainId)] ?? {};
  const get = (name: EventName) => totals[name] ?? { count: 0, valueUsd: 0 };
  const tools = (Object.keys(TOOL_LABELS) as EventName[])
    .filter((name) => name !== 'wallet_connected')
    .map((name) => ({ name, ...get(name) }))
    .sort((a, b) => b.count - a.count || b.valueUsd - a.valueUsd);
  return {
    orderValueUsd: ORDER_EVENTS.reduce((sum, name) => sum + get(name).valueUsd, 0),
    orderActions: ORDER_EVENTS.reduce((sum, name) => sum + get(name).count, 0),
    walletSessions: get('wallet_connected').count,
    shares: get('card_shared').count,
    tools,
    daily: data.daily.map((d) => ({ day: d.day, valueUsd: d.byChain[String(chainId)]?.valueUsd ?? 0 })),
  };
}
