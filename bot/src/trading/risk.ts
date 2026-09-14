import axios from 'axios';
import { ENV } from '../config/env';
import { notify, recordError } from '../alerts';
import { botState } from '../state';

export interface Fill {
  submissionIdx: bigint;
  timestamp: number; // unix seconds
  realizedPnl: number; // USDT0
  fee: number; // USDT0
}

/** Start of the current UTC day, in unix seconds. The daily loss limit resets at 00:00 UTC. */
export function utcDayStartSec(nowMs: number) {
  const d = new Date(nowMs);
  return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 1000);
}

/**
 * Net trading result since `sinceSec`: realized PnL minus fees. Checked against a live testnet round trip,
 * this matched the account's actual USDT0 change to within funding. Entry fees count as soon as they're paid.
 */
export function netPnlSince(fills: Fill[], sinceSec: number) {
  return fills.filter((f) => f.timestamp >= sinceSec).reduce((sum, f) => sum + f.realizedPnl - f.fee, 0);
}

export const MAX_RISK_STALENESS_MS = 5 * 60_000;

/**
 * Pure: why new buys must not happen right now, or null if they may. Fails closed: if today's PnL
 * couldn't be read recently, buying is blocked rather than trading blind past the limit.
 */
export function decideBuyBlock(p: { tradingPaused: boolean; dailyLossLimitUsd: number; dailyNetPnl: number | null; lastCheckAgeMs: number | null }) {
  if (p.tradingPaused) return 'Kill switch on (TRADING_PAUSED=true): new buys are paused.';
  if (p.dailyLossLimitUsd <= 0) return null;
  if (p.dailyNetPnl === null || p.lastCheckAgeMs === null || p.lastCheckAgeMs > MAX_RISK_STALENESS_MS) {
    return "Daily loss limit can't be verified (Nado trade history unavailable): new buys are paused until it can.";
  }
  if (p.dailyNetPnl <= -p.dailyLossLimitUsd) {
    return `Daily loss limit hit: -$${Math.abs(p.dailyNetPnl).toFixed(2)} today vs a $${p.dailyLossLimitUsd} limit. New buys resume at 00:00 UTC.`;
  }
  return null;
}

const x18 = (v: string | undefined) => (v ? Number(BigInt(v)) / 1e18 : 0);

/** All of the subaccount's fills (every product) since `sinceSec`, paged newest-first from Nado's archive. */
export async function fetchFillsSince(sender: string, sinceSec: number): Promise<Fill[]> {
  const fills: Fill[] = [];
  let idx: bigint | null = null;
  for (let page = 0; page < 10; page++) {
    const body = { matches: { subaccounts: [sender], limit: 100, ...(idx !== null ? { idx: idx.toString() } : {}) } };
    const { data } = await axios.post(ENV.NADO_ARCHIVE_URL, body, { headers: { 'Accept-Encoding': 'gzip, br, deflate' }, timeout: 15_000 });
    const times = new Map<string, number>((data.txs ?? []).map((t: any) => [String(t.submission_idx), Number(t.timestamp)]));
    const matches: any[] = data.matches ?? [];
    for (const m of matches) {
      fills.push({
        submissionIdx: BigInt(m.submission_idx),
        timestamp: times.get(String(m.submission_idx)) ?? 0,
        realizedPnl: x18(m.realized_pnl),
        fee: x18(m.fee),
      });
    }
    const oldest = fills[fills.length - 1];
    if (matches.length < 100 || !oldest || oldest.timestamp < sinceSec) break;
    idx = oldest.submissionIdx - 1n;
  }
  return fills;
}

let lastLimitAlertDay: number | null = null;

export async function refreshRisk(sender: string) {
  const dayStart = utcDayStartSec(Date.now());
  try {
    const net = netPnlSince(await fetchFillsSince(sender, dayStart), dayStart);
    botState.risk.dailyNetPnl = net;
    botState.risk.checkedAt = new Date().toISOString();
  } catch (e: any) {
    recordError(`risk: could not read trade history: ${e.message}`);
  }

  const block = currentBuyBlock();
  botState.risk.buyBlockedReason = block;
  const limitHit = block?.startsWith('Daily loss limit hit') ?? false;
  if (limitHit && lastLimitAlertDay !== dayStart) {
    lastLimitAlertDay = dayStart;
    await notify(`${block} Open positions stay protected by their stop-loss/take-profit.`, 'warn');
  }
}

export function currentBuyBlock() {
  const checkedAt = botState.risk.checkedAt;
  return decideBuyBlock({
    tradingPaused: ENV.TRADING_PAUSED,
    dailyLossLimitUsd: ENV.DAILY_LOSS_LIMIT_USD,
    dailyNetPnl: botState.risk.dailyNetPnl,
    lastCheckAgeMs: checkedAt ? Date.now() - new Date(checkedAt).getTime() : null,
  });
}

export function startRiskLoop(sender: string) {
  const run = () => refreshRisk(sender).catch((e) => console.error('Risk check failed:', e.message));
  run();
  return setInterval(run, 60_000);
}
