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
};

export function recordError(message: string) {
  botState.lastError = { at: new Date().toISOString(), message };
}
