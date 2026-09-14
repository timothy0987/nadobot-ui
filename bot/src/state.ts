import type { BotEvent } from './alerts';

/** In-memory snapshot of what the bot is doing, served read-only by the status endpoint. */
export const botState = {
  startedAt: new Date().toISOString(),
  sessionHigh: 0,
  lastPrice: 0,
  lastBuyAt: null as string | null,
  lastSkippedBuyReason: null as string | null,
  lastProtectionCheckAt: null as string | null,
  position: null as null | { amount: number; avgEntryPrice: number },
  protection: null as null | { stopPrice: number; takeProfitPrice: number; size: number; digests: string[] },
  lastError: null as null | { at: string; message: string },
  risk: {
    dailyNetPnl: null as number | null, // realized PnL minus fees since 00:00 UTC, all products
    checkedAt: null as string | null,
    buyBlockedReason: null as string | null,
  },
  // Newest first. Lives in memory, so a restart starts a fresh log (the "Bot started" event marks it).
  events: [] as BotEvent[],
};

