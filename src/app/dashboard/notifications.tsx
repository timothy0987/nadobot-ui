'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BOT_STATUS_URL,
  INK_MAINNET,
  INK_SEPOLIA,
  fetchBotStatus,
  fetchMatches,
  fetchSymbols,
  type BotStatus,
  type Match,
  type NadoNetwork,
} from '@/lib/nado';

export interface Toast {
  key: string;
  level: 'info' | 'warn' | 'error';
  title: string;
  body: string;
}

const usd = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

/** Polls the always-on bot's public status: strategy, position, protection, fills and its activity feed. */
export function useBotStatus() {
  const [status, setStatus] = useState<BotStatus | null>(null);
  const [fills, setFills] = useState<Match[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!BOT_STATUS_URL) return;
    let cancelled = false;
    const load = async () => {
      try {
        const s = await fetchBotStatus();
        if (cancelled) return;
        setStatus(s);
        setError(null);
        const network = s.network === 'mainnet' ? INK_MAINNET : INK_SEPOLIA;
        const symbol = (await fetchSymbols(network))[s.product];
        if (symbol && !cancelled) setFills(await fetchMatches(network, s.subaccount, [symbol.product_id], 10));
      } catch (e: any) {
        if (!cancelled) setError(e.message);
      }
    };
    load();
    const id = setInterval(load, 15_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return { status, fills, error };
}

/** Recent fills on the connected wallet's subaccount, so a plan's entry or exit filling can be announced. */
export function useWalletFills(network: NadoNetwork, sender: string | null, productIds: number[]) {
  const [fills, setFills] = useState<Match[] | null>(null);
  const ids = productIds.join(',');

  useEffect(() => {
    setFills(null);
    if (!sender || !ids) return;
    let cancelled = false;
    const load = () =>
      fetchMatches(network, sender, ids.split(',').map(Number), 20)
        .then((f) => !cancelled && setFills(f))
        .catch(() => {});
    load();
    const id = setInterval(load, 15_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [network, sender, ids]);

  return fills;
}

/**
 * Turns new bot events and new wallet fills into in-app toasts, plus browser notifications when allowed.
 * Whatever already exists when the page first loads is treated as seen, so opening the dApp never replays history.
 */
export function useNotifications(bot: BotStatus | null, walletFills: Match[] | null, symbolById: Record<number, string>, pushEnabled: boolean) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seen = useRef<Set<string> | null>(null);
  const seenFills = useRef<Set<string> | null>(null);

  const push = useCallback((toast: Toast) => {
    setToasts((t) => [toast, ...t].slice(0, 5));
    setTimeout(() => setToasts((t) => t.filter((x) => x.key !== toast.key)), 10_000);
    // With web push on, the service worker notifies while the tab is hidden; notifying here too would double up.
    const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
    if (!pushEnabled && hidden && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      try {
        new Notification(toast.title, { body: toast.body, tag: toast.key });
      } catch {
        // Some mobile browsers only allow notifications from a service worker; the in-app toast still shows.
      }
    }
  }, [pushEnabled]);

  useEffect(() => {
    if (!bot?.events) return;
    // A restart resets event ids, so key them by the bot's start time too.
    const keys = bot.events.map((e) => `${bot.startedAt}:${e.id}`);
    if (!seen.current) {
      seen.current = new Set(keys);
      return;
    }
    bot.events
      .slice()
      .reverse()
      .forEach((e, i) => {
        const key = keys[keys.length - 1 - i];
        if (seen.current!.has(key)) return;
        seen.current!.add(key);
        push({ key, level: e.level, title: e.level === 'error' ? 'Nadobot error' : e.level === 'warn' ? 'Nadobot warning' : 'Nadobot', body: e.message });
      });
  }, [bot, push]);

  useEffect(() => {
    if (!walletFills) return;
    const keys = walletFills.map((f) => `${f.submissionIdx}:${f.digest}`);
    if (!seenFills.current) {
      seenFills.current = new Set(keys);
      return;
    }
    walletFills
      .slice()
      .reverse()
      .forEach((f, i) => {
        const key = keys[keys.length - 1 - i];
        if (seenFills.current!.has(key)) return;
        seenFills.current!.add(key);
        const side = f.baseFilled > 0 ? 'Bought' : 'Sold';
        const price = f.baseFilled ? Math.abs(f.quoteFilled / f.baseFilled) : 0;
        const pnl = f.realizedPnl ? ` · realized ${f.realizedPnl < 0 ? '-' : '+'}${usd(Math.abs(f.realizedPnl))}` : '';
        push({
          key: `fill:${key}`,
          level: 'info',
          title: 'Your order filled',
          body: `${side} ${Math.abs(f.baseFilled)} ${symbolById[f.productId] ?? ''} at ${usd(price)}${pnl}`,
        });
      });
  }, [walletFills, symbolById, push]);

  const dismiss = useCallback((key: string) => setToasts((t) => t.filter((x) => x.key !== key)), []);

  return { toasts, dismiss };
}

export function Toasts({ toasts, dismiss }: { toasts: Toast[]; dismiss: (key: string) => void }) {
  if (toasts.length === 0) return null;
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.key} className={`toast glass ${t.level}`}>
          <div>
            <strong>{t.title}</strong>
            <p>{t.body}</p>
          </div>
          <button className="toast-close" onClick={() => dismiss(t.key)} aria-label="Dismiss">
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------- web push ------------------------------- */

export type PushTopic = 'fills' | 'bot';
export type PushSupport = 'checking' | 'supported' | 'unsupported' | 'ios-install';

const TOPICS_KEY = 'nadobot:push-topics';
const botApi = (path: string) => `${BOT_STATUS_URL.replace(/\/$/, '')}${path}`;

function base64UrlToBytes(base64Url: string) {
  const padded = (base64Url + '='.repeat((4 - (base64Url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

const sameKey = (a: ArrayBuffer | null | undefined, b: Uint8Array) => !!a && a.byteLength === b.byteLength && new Uint8Array(a).every((v, i) => v === b[i]);

export async function postBotJson(path: string, body: unknown) {
  const res = await fetch(botApi(path), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `Bot returned ${res.status}`);
  return json;
}

const postBot = postBotJson;

/**
 * Web push: notifications for order fills and bot activity even when the dashboard is closed. The bot on Railway
 * holds the subscription and sends the pushes; this hook subscribes the browser and keeps the preferences in sync.
 */
export function usePush(sender: string | null, chainId: number) {
  const [support, setSupport] = useState<PushSupport>('checking');
  const [subscription, setSubscription] = useState<PushSubscription | null>(null);
  const [topics, setTopicsState] = useState<PushTopic[]>(['fills', 'bot']);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const registration = useRef<ServiceWorkerRegistration | null>(null);
  const synced = useRef<string>('');

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(TOPICS_KEY) ?? 'null');
      if (Array.isArray(saved) && saved.length) setTopicsState(saved);
    } catch {}

    if (!BOT_STATUS_URL || !('serviceWorker' in navigator) || !('PushManager' in window) || typeof Notification === 'undefined') {
      // iPhone/iPad Safari only exposes push once the site is added to the Home Screen.
      const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window.matchMedia?.('(display-mode: standalone)').matches);
      setSupport(ios ? 'ios-install' : 'unsupported');
      return;
    }
    navigator.serviceWorker
      .register('/sw.js')
      .then(async (reg) => {
        registration.current = reg;
        setSubscription(await reg.pushManager.getSubscription());
        setSupport('supported');
      })
      .catch(() => setSupport('unsupported'));
  }, []);

  const sync = useCallback(
    async (sub: PushSubscription, wanted: PushTopic[]) => {
      const effective = wanted.filter((t) => t !== 'fills' || sender);
      if (effective.length === 0) throw new Error('Connect a wallet or turn on bot activity to get notifications');
      await postBot('/push/subscribe', { subscription: sub.toJSON(), subaccount: sender, topics: effective, chainId });
      synced.current = `${sub.endpoint}|${sender}|${effective.join(',')}|${chainId}`;
    },
    [sender, chainId]
  );

  const enable = useCallback(
    async (wanted: PushTopic[]) => {
      if (!registration.current) return;
      setBusy(true);
      setError(null);
      try {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') throw new Error('Notifications are blocked for this site in your browser settings');
        const res = await fetch(botApi('/push/public-key'));
        const { publicKey } = await res.json();
        const key = base64UrlToBytes(publicKey);

        let sub = await registration.current.pushManager.getSubscription();
        // If the bot's key pair changed (e.g. its storage was reset), the old subscription can no longer receive pushes.
        if (sub && !sameKey(sub.options.applicationServerKey, key)) {
          await sub.unsubscribe();
          sub = null;
        }
        sub ??= await registration.current.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
        await sync(sub, wanted);
        setSubscription(sub);
        setTopicsState(wanted);
        localStorage.setItem(TOPICS_KEY, JSON.stringify(wanted));
      } catch (e: any) {
        setError(e.message);
      } finally {
        setBusy(false);
      }
    },
    [sync]
  );

  const disable = useCallback(async () => {
    if (!subscription) return;
    setBusy(true);
    setError(null);
    try {
      await postBot('/push/unsubscribe', { endpoint: subscription.endpoint }).catch(() => {});
      await subscription.unsubscribe();
      setSubscription(null);
      synced.current = '';
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }, [subscription]);

  // Keep the bot pointed at whichever wallet is connected now.
  useEffect(() => {
    if (!subscription) return;
    const effective = topics.filter((t) => t !== 'fills' || sender);
    const key = `${subscription.endpoint}|${sender}|${effective.join(',')}|${chainId}`;
    if (key === synced.current || effective.length === 0) return;
    sync(subscription, topics).catch((e) => setError(e.message));
  }, [subscription, sender, chainId, topics, sync]);

  return { support, enabled: Boolean(subscription), endpoint: subscription?.endpoint ?? null, topics, busy, error, enable, disable };
}
