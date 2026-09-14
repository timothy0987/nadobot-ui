import { botState } from './state';

export type EventLevel = 'info' | 'warn' | 'error';

export interface BotEvent {
  id: number;
  at: string;
  level: EventLevel;
  message: string;
  count: number;
}

const MAX_EVENTS = 50;
const REPEAT_WINDOW_MS = 10 * 60_000;
let nextId = 1;

/**
 * Pure: appends an event to the newest-first log. A message identical to the most recent one within 10 minutes
 * bumps its counter instead of adding a row, so a retrying failure can't flood the dashboard.
 */
export function appendEvent(events: BotEvent[], level: EventLevel, message: string, now: Date, id: number): BotEvent[] {
  const latest = events[0];
  if (latest && latest.message === message && latest.level === level && now.getTime() - new Date(latest.at).getTime() < REPEAT_WINDOW_MS) {
    return [{ ...latest, at: now.toISOString(), count: latest.count + 1 }, ...events.slice(1)];
  }
  return [{ id, at: now.toISOString(), level, message, count: 1 }, ...events].slice(0, MAX_EVENTS);
}

/** Records an alert in the bot's event log. The dApp reads it from GET /status and notifies the user. */
export async function notify(message: string, level: EventLevel = 'info') {
  console.log(`${level.toUpperCase()}: ${message}`);
  botState.events = appendEvent(botState.events, level, message, new Date(), nextId++);
}

/** Records the latest error for the status endpoint and logs it to the dApp event feed. */
export function recordError(message: string) {
  botState.lastError = { at: new Date().toISOString(), message };
  void notify(message, 'error');
}
