'use client';

import { useCallback, useEffect, useState } from 'react';
import { formatPrice, priceInputValue, type NadoNetwork, type ProductSymbol } from '@/lib/nado';
import { postBotJson } from '../notifications';
import { track } from '@/lib/analytics';

export interface PriceAlert {
  id: string;
  chainId: number;
  productId: number;
  symbol: string;
  direction: 'above' | 'below';
  price: number;
  createdAt: string;
}

interface Props {
  network: NadoNetwork;
  product: ProductSymbol | undefined;
  bid: number | null;
  ask: number | null;
  /** This device's push subscription; alerts belong to the device, not the wallet. */
  endpoint: string | null;
  pushEnabled: boolean;
}

/**
 * "Tell me when BTC hits $80,000." The bot watches the price and pushes a notification that opens the dashboard on
 * that market, so the trader can act on it straight away. No wallet or signature involved.
 */
export function PriceAlerts({ network, product, bid, ask, endpoint, pushEnabled }: Props) {
  const [alerts, setAlerts] = useState<PriceAlert[] | null>(null);
  const [direction, setDirection] = useState<'above' | 'below'>('above');
  const [price, setPrice] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const market = bid && ask ? (bid + ask) / 2 : null;
  const tick = product?.price_increment_x18;
  // Suggest a level 5% away, in the direction being watched.
  const suggested = market ? market * (direction === 'above' ? 1.05 : 0.95) : 0;

  const load = useCallback(async () => {
    if (!endpoint) return setAlerts(null);
    try {
      const { alerts } = await postBotJson('/push/alerts/list', { endpoint });
      setAlerts(alerts ?? []);
    } catch (e: any) {
      setError(e.message);
    }
  }, [endpoint]);

  useEffect(() => {
    load();
  }, [load]);

  async function add() {
    if (!endpoint || !product || !market) return;
    setBusy(true);
    setError(null);
    try {
      const { alerts } = await postBotJson('/push/alerts', {
        endpoint,
        alert: {
          chainId: network.chainId,
          productId: product.product_id,
          symbol: product.symbol,
          direction,
          price: Number(price) || suggested,
          priceWhenSet: market,
        },
      });
      setAlerts(alerts ?? []);
      setPrice('');
      track('alert_set', network.chainId);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!endpoint) return;
    setBusy(true);
    try {
      const { alerts } = await postBotJson('/push/alerts/delete', { endpoint, id });
      setAlerts(alerts ?? []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="glass panel">
      <div className="panel-header">
        <div>
          <h3>Price alerts</h3>
          <p className="muted" style={{ marginTop: '0.4rem', maxWidth: 640 }}>
            Get a notification when a market reaches a price, even with this dashboard closed. Opening the notification brings you
            straight to that market. Alerts are kept for this device and need no wallet.
          </p>
        </div>
      </div>

      {!pushEnabled ? (
        <p className="muted">Turn on push notifications below to use price alerts.</p>
      ) : (
        <>
          <div className="form-row">
            <label className="field">
              <span>Market</span>
              <input type="text" value={product?.symbol ?? '…'} disabled />
            </label>
            <label className="field">
              <span>Tell me when the price</span>
              <select value={direction} onChange={(e) => setDirection(e.target.value as 'above' | 'below')}>
                <option value="above">rises to or above</option>
                <option value="below">falls to or below</option>
              </select>
            </label>
            <label className="field">
              <span>Price</span>
              <input
                type="number"
                min="0"
                step="any"
                placeholder={suggested && tick ? priceInputValue(suggested, tick) : ''}
                value={price}
                onChange={(e) => setPrice(e.target.value)}
              />
            </label>
            <div className="form-row">
              <button className="btn btn-primary btn-sm" onClick={add} disabled={busy || !product || !market}>
                {busy ? 'Saving…' : 'Watch this price'}
              </button>
            </div>
          </div>
          {market && tick && <p className="muted">{product?.symbol} is {formatPrice(market, tick)} now.</p>}
        </>
      )}

      {error && <div className="notice error">{error}</div>}

      {alerts && alerts.length > 0 && (
        <ul className="activity" style={{ marginTop: '1rem' }}>
          {alerts.map((a) => (
            <li key={a.id} style={{ alignItems: 'center' }}>
              <span className="activity-dot" aria-hidden />
              <div style={{ flex: 1 }}>
                <p>
                  {a.symbol} {a.direction === 'above' ? '≥' : '≤'} {formatPrice(a.price, a.productId === product?.product_id ? tick : undefined)}
                </p>
                <span className="muted">
                  {a.chainId === network.chainId ? 'This network' : a.chainId === 57073 ? 'Mainnet' : 'Testnet'} · set{' '}
                  {new Date(a.createdAt).toLocaleString()}
                </span>
              </div>
              <button className="btn btn-secondary btn-sm" onClick={() => remove(a.id)} disabled={busy}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {pushEnabled && alerts?.length === 0 && <p className="muted">No price alerts yet.</p>}
    </div>
  );
}
