import { BOT_STATUS_URL } from './nado';

export type EventName =
  | 'wallet_connected'
  | 'market_order'
  | 'plan_created'
  | 'ladder_placed'
  | 'twap_started'
  | 'dca_started'
  | 'position_protected'
  | 'position_closed'
  | 'exit_moved'
  | 'alert_set'
  | 'dca_reminder_set'
  | 'card_shared';

/** Pure: whether the browser asked not to be tracked, through Do Not Track or Global Privacy Control. */
export function trackingDeclined(nav: { doNotTrack?: string | null; globalPrivacyControl?: boolean } | undefined): boolean {
  return nav?.doNotTrack === '1' || nav?.globalPrivacyControl === true;
}

/**
 * Pure: the only data an event carries. No wallet address, account, market or identifier: just what happened, on which
 * network, and the order value involved.
 */
export function eventPayload(name: EventName, chainId: number, valueUsd = 0) {
  return { name, chainId, valueUsd: Number.isFinite(valueUsd) && valueUsd > 0 ? Math.round(valueUsd * 100) / 100 : 0 };
}

/** Counts one anonymous usage event. Fire-and-forget: it never slows down or breaks what the trader is doing. */
export function track(name: EventName, chainId: number, valueUsd = 0) {
  try {
    if (typeof window === 'undefined' || trackingDeclined(navigator as any) || !BOT_STATUS_URL) return;
    fetch(`${BOT_STATUS_URL.replace(/\/$/, '')}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(eventPayload(name, chainId, valueUsd)),
      keepalive: true,
    }).catch(() => {});
  } catch {}
}
