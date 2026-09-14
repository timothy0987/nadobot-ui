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
export function useNotifications(bot: BotStatus | null, walletFills: Match[] | null, symbolById: Record<number, string>) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>('unsupported');
  const seen = useRef<Set<string> | null>(null);
  const seenFills = useRef<Set<string> | null>(null);

  useEffect(() => {
    setPermission(typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);
  }, []);

  const push = useCallback((toast: Toast) => {
    setToasts((t) => [toast, ...t].slice(0, 5));
    setTimeout(() => setToasts((t) => t.filter((x) => x.key !== toast.key)), 10_000);
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      try {
        new Notification(toast.title, { body: toast.body, tag: toast.key });
      } catch {
        // Some mobile browsers only allow notifications from a service worker; the in-app toast still shows.
      }
    }
  }, []);

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

  const requestPermission = useCallback(async () => {
    if (typeof Notification === 'undefined') return;
    setPermission(await Notification.requestPermission());
  }, []);

  const dismiss = useCallback((key: string) => setToasts((t) => t.filter((x) => x.key !== key)), []);

  return { toasts, dismiss, permission, requestPermission };
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
