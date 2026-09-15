import axios from 'axios';
import webpush from 'web-push';
import { ENV } from '../config/env';
import { PushStore, type PushRecord } from './store';
import type { SubscribeInput } from './validate';
import { alertTriggered, describeAlert, MAX_ALERTS_PER_SUBSCRIPTION, type PriceAlert } from './alerts';

export interface PushPayload {
  title: string;
  body: string;
  tag: string;
  url: string;
  level?: 'info' | 'warn' | 'error';
}

export interface ArchiveFill {
  submissionIdx: bigint;
  productId: number;
  baseFilled: number;
  quoteFilled: number;
  realizedPnl: number;
}

const MAX_SUBSCRIPTIONS = 1000;
const NETWORK_URLS: Record<number, { gateway: string; archive: string }> = {
  57073: { gateway: 'https://gateway.prod.nado.xyz/v1', archive: 'https://archive.prod.nado.xyz/v1' },
  763373: { gateway: 'https://gateway.test.nado.xyz/v1', archive: 'https://archive.test.nado.xyz/v1' },
};
const headers = { 'Accept-Encoding': 'gzip, br, deflate' };
const MAX_PUSHES_PER_WALLET_PER_CYCLE = 5;
const x18 = (v: string | undefined) => (v ? Number(BigInt(v)) / 1e18 : 0);
const usd = (n: number) => `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;

let store: PushStore | null = null;

export function initPush() {
  store = new PushStore(ENV.DATA_DIR, ENV.CHAIN_ID);
  webpush.setVapidDetails(ENV.PUSH_SUBJECT, store.vapid.publicKey, store.vapid.privateKey);
  console.log(`Push notifications ready: ${store.subscriptions.length} subscription(s) in ${ENV.DATA_DIR}`);
  return store;
}

export const pushPublicKey = () => store?.vapid.publicKey ?? null;
export const pushSubscriptionCount = () => store?.subscriptions.length ?? 0;

async function send(record: PushRecord, payload: PushPayload) {
  try {
    await webpush.sendNotification({ endpoint: record.endpoint, keys: record.keys }, JSON.stringify(payload), { TTL: 6 * 3600, urgency: 'high' });
  } catch (e: any) {
    // 404/410 mean the browser unsubscribed or the subscription expired: stop sending to it.
    if (e.statusCode === 404 || e.statusCode === 410) store?.remove(record.endpoint);
    else console.error(`Push to ${new URL(record.endpoint).hostname} failed: ${e.statusCode ?? ''} ${e.body ?? e.message}`);
  }
}

/** Pushes a new bot activity event to everyone subscribed to bot activity. */
export async function pushBotEvent(level: 'info' | 'warn' | 'error', message: string) {
  if (!store) return;
  const title = level === 'error' ? 'Nadobot error' : level === 'warn' ? 'Nadobot warning' : 'Nadobot';
  const targets = store.subscriptions.filter((s) => s.topics.includes('bot'));
  await Promise.all(targets.map((s) => send(s, { title, body: message, tag: `bot-${Date.now()}`, url: '/dashboard', level })));
}

async function fetchRecentFills(chainId: number, subaccount: string, limit: number): Promise<ArchiveFill[]> {
  const { data } = await axios.post(
    NETWORK_URLS[chainId].archive,
    { matches: { subaccounts: [subaccount], limit } },
    { headers, timeout: 15_000 }
  );
  return (data.matches ?? []).map((m: any) => ({
    submissionIdx: BigInt(m.submission_idx),
    productId: Number(m.pre_balance?.base?.perp?.product_id ?? m.pre_balance?.base?.spot?.product_id ?? -1),
    baseFilled: x18(m.base_filled),
    quoteFilled: x18(m.quote_filled),
    realizedPnl: x18(m.realized_pnl),
  }));
}

/** Pure: which fills are newer than what this wallet was last told about, oldest first, capped per cycle. */
export function selectNewFills(fills: ArchiveFill[], lastSeen: string | null, cap = MAX_PUSHES_PER_WALLET_PER_CYCLE) {
  const seen = lastSeen === null ? null : BigInt(lastSeen);
  const fresh = fills.filter((f) => seen === null || f.submissionIdx > seen).sort((a, b) => (a.submissionIdx < b.submissionIdx ? -1 : 1));
  return { toPush: fresh.slice(-cap), newest: fresh.length ? fresh[fresh.length - 1].submissionIdx : null };
}

export function describeFill(f: ArchiveFill, symbol: string) {
  const price = f.baseFilled ? Math.abs(f.quoteFilled / f.baseFilled) : 0;
  const pnl = f.realizedPnl ? ` · realized ${f.realizedPnl < 0 ? '-' : '+'}${usd(Math.abs(f.realizedPnl))}` : '';
  return `${f.baseFilled > 0 ? 'Bought' : 'Sold'} ${Math.abs(f.baseFilled)} ${symbol} at ${usd(price)}${pnl}`;
}

export async function subscribe(input: SubscribeInput) {
  if (!store) throw new Error('Push not initialised');
  const existing = store.subscriptions.find((s) => s.endpoint === input.endpoint);
  if (!existing && store.subscriptions.length >= MAX_SUBSCRIPTIONS) throw new Error('Subscription limit reached');

  // Start from the wallet's current newest fill so subscribing never replays its history.
  const chainId = input.chainId ?? ENV.CHAIN_ID;
  const sameWallet = existing?.subaccount === input.subaccount && existing?.chainId === chainId;
  let lastSeen = sameWallet ? existing!.lastSeenSubmissionIdx : null;
  if (input.subaccount && lastSeen === null) {
    const latest = await fetchRecentFills(chainId, input.subaccount, 1);
    lastSeen = latest[0]?.submissionIdx.toString() ?? '0';
  }

  const record: PushRecord = { ...input, chainId, createdAt: existing?.createdAt ?? new Date().toISOString(), lastSeenSubmissionIdx: lastSeen };
  store.upsert(record);
  await send(record, {
    title: 'Nadobot notifications are on',
    body: input.topics.includes('fills') ? "You'll be notified when your orders fill, even with the dashboard closed." : "You'll be notified about Nadobot activity.",
    tag: 'push-enabled',
    url: '/dashboard',
  });
}

export const unsubscribe = (endpoint: string) => store?.remove(endpoint);

const symbolCache: Record<number, { at: number; byId: Record<number, string> }> = {};
async function symbolById(chainId: number, productId: number) {
  const cached = symbolCache[chainId];
  if (!cached || Date.now() - cached.at > 10 * 60_000) {
    const { data } = await axios.post(`${NETWORK_URLS[chainId].gateway}/query`, { type: 'symbols' }, { headers, timeout: 15_000 });
    const symbols: any[] = Object.values(data.data.symbols);
    symbolCache[chainId] = { at: Date.now(), byId: Object.fromEntries(symbols.map((s) => [s.product_id, s.symbol])) };
  }
  return symbolCache[chainId].byId[productId] ?? `product ${productId}`;
}

/** Every 30s, checks each subscribed wallet for new fills on Nado and pushes them. */
export function startFillWatcher() {
  let running = false;
  const run = async () => {
    if (!store || running) return;
    running = true;
    try {
      const wallets = new Map<string, PushRecord[]>();
      for (const s of store.subscriptions) {
        if (!s.subaccount || !s.topics.includes('fills') || !NETWORK_URLS[s.chainId]) continue;
        const key = `${s.chainId}:${s.subaccount}`;
        wallets.set(key, [...(wallets.get(key) ?? []), s]);
      }
      for (const [key, subs] of wallets) {
        const chainId = subs[0].chainId;
        const subaccount = subs[0].subaccount!;
        try {
          const lastSeen = subs.map((s) => s.lastSeenSubmissionIdx).find((v) => v !== null) ?? null;
          const { toPush, newest } = selectNewFills(await fetchRecentFills(chainId, subaccount, 20), lastSeen);
          for (const fill of toPush) {
            const body = describeFill(fill, await symbolById(chainId, fill.productId));
            await Promise.all(subs.map((s) => send(s, { title: 'Your order filled', body, tag: `fill-${fill.submissionIdx}`, url: '/dashboard' })));
          }
          if (newest !== null) store.setLastSeen(chainId, subaccount, newest.toString());
        } catch (e: any) {
          console.error(`Fill watch for ${key.slice(0, 18)}… failed: ${e.message}`);
        }
      }
    } finally {
      running = false;
    }
  };
  return setInterval(run, 30_000);
}

/* ---------------------------------- price alerts ---------------------------------- */

/** Alerts a device is watching, newest first. */
export function listAlerts(endpoint: string): PriceAlert[] {
  return [...(store?.subscriptions.find((s) => s.endpoint === endpoint)?.alerts ?? [])].reverse();
}

export function addAlert(endpoint: string, alert: PriceAlert) {
  if (!store) throw new Error('Push not initialised');
  const record = store.subscriptions.find((s) => s.endpoint === endpoint);
  if (!record) throw new Error('Turn on notifications for this device first');
  const alerts = record.alerts ?? [];
  if (alerts.length >= MAX_ALERTS_PER_SUBSCRIPTION) throw new Error(`You can watch at most ${MAX_ALERTS_PER_SUBSCRIPTION} prices at a time`);
  if (alerts.some((a) => a.chainId === alert.chainId && a.productId === alert.productId && a.direction === alert.direction && a.price === alert.price)) {
    throw new Error('You are already watching that price');
  }
  store.setAlerts(endpoint, [...alerts, alert]);
  return alert;
}

export function removeAlert(endpoint: string, id: string) {
  const record = store?.subscriptions.find((s) => s.endpoint === endpoint);
  if (!record) return false;
  return store!.setAlerts(endpoint, (record.alerts ?? []).filter((a) => a.id !== id));
}

/** Oracle price of every product on a network, keyed by product id. */
async function fetchPrices(chainId: number): Promise<Record<number, number>> {
  const { data } = await axios.post(`${NETWORK_URLS[chainId].gateway}/query`, { type: 'all_products' }, { headers, timeout: 15_000 });
  const prices: Record<number, number> = {};
  for (const p of [...(data.data?.spot_products ?? []), ...(data.data?.perp_products ?? [])]) prices[p.product_id] = x18(p.oracle_price_x18);
  return prices;
}

/**
 * Every 30s, checks the markets that alerts are waiting on and notifies the devices whose level was crossed. An alert
 * fires once and is then removed, so a price hovering around the level can't send the same notification repeatedly.
 */
export function startPriceWatcher(fetchAll: (chainId: number) => Promise<Record<number, number>> = fetchPrices) {
  const previous: Record<number, Record<number, number>> = {};
  let running = false;

  const run = async () => {
    if (!store || running) return;
    running = true;
    try {
      const chains = new Set<number>();
      for (const s of store.subscriptions) for (const a of s.alerts ?? []) if (NETWORK_URLS[a.chainId]) chains.add(a.chainId);

      for (const chainId of chains) {
        let prices: Record<number, number>;
        try {
          prices = await fetchAll(chainId);
        } catch (e: any) {
          console.error(`Price watch on chain ${chainId} failed: ${e.message}`);
          continue;
        }
        const before = previous[chainId] ?? {};

        for (const record of store.subscriptions) {
          const alerts = record.alerts ?? [];
          const fired = alerts.filter((a) => a.chainId === chainId && alertTriggered(a, before[a.productId], prices[a.productId]));
          if (!fired.length) continue;
          store.setAlerts(
            record.endpoint,
            alerts.filter((a) => !fired.includes(a))
          );
          for (const alert of fired) {
            await send(record, {
              title: 'Price alert',
              body: describeAlert(alert, prices[alert.productId]),
              tag: `alert-${alert.id}`,
              // Opens the dashboard on that market, ready to trade.
              url: `/dashboard?market=${encodeURIComponent(alert.symbol)}`,
            });
          }
        }
        previous[chainId] = prices;
      }
    } finally {
      running = false;
    }
  };
  return setInterval(run, 30_000);
}
