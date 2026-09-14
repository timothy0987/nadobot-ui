'use client';

import { useState } from 'react';
import {
  fromX18,
  placeTriggerOrder,
  roundToIncrement,
  toX18,
  type NadoNetwork,
  type PerpPosition,
  type ProductSymbol,
  type SignTypedDataAsync,
} from '@/lib/nado';

interface Props {
  network: NadoNetwork;
  sign: SignTypedDataAsync;
  sender: `0x${string}`;
  product: ProductSymbol;
  position: PerpPosition;
  onPlaced: () => void;
}

const usd = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

/** Attach a stop-loss and take-profit to a position the trader already holds (opened manually or by a plan). */
export function ProtectPosition({ network, sign, sender, product, position, onPlaced }: Props) {
  const [stopLossPct, setStopLossPct] = useState('5');
  const [takeProfitPct, setTakeProfitPct] = useState('10');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const isLong = position.amount > 0n;
  const entry = fromX18(position.avgEntryPriceX18);
  const increment = BigInt(product.price_increment_x18);
  const tick = (price: number, mode: 'down' | 'up' | 'nearest') => roundToIncrement(toX18(price), increment, mode);
  const stop = entry * (isLong ? 1 - Number(stopLossPct) / 100 : 1 + Number(stopLossPct) / 100);
  const takeProfit = entry * (isLong ? 1 + Number(takeProfitPct) / 100 : 1 - Number(takeProfitPct) / 100);

  async function protect() {
    setBusy(true);
    setMessage(null);
    try {
      const exitMode = isLong ? 'down' : 'up'; // exits on a long are sells, on a short are buys
      const worse = isLong ? 0.995 : 1.005;
      const common = { productId: product.product_id, sender, amount: -position.amount, reduceOnly: true };
      const stopX18 = tick(stop, 'nearest');
      const takeProfitX18 = tick(takeProfit, 'nearest');

      await placeTriggerOrder(network, sign, {
        ...common,
        priceX18: tick(stop * worse, exitMode),
        priceRequirement: isLong ? { last_price_below: stopX18.toString() } : { last_price_above: stopX18.toString() },
      });
      await placeTriggerOrder(network, sign, {
        ...common,
        priceX18: tick(takeProfit * worse, exitMode),
        priceRequirement: isLong ? { last_price_above: takeProfitX18.toString() } : { last_price_below: takeProfitX18.toString() },
      });
      setMessage({ ok: true, text: 'Stop-loss and take-profit placed. They stay active on Nado even if you close this page.' });
      onPlaced();
    } catch (e: any) {
      setMessage({ ok: false, text: `Failed to set protection: ${e.shortMessage ?? e.message}` });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="glass panel">
      <div className="panel-header">
        <div>
          <h3>Protect open position</h3>
          <p className="muted" style={{ marginTop: '0.4rem', maxWidth: 640 }}>
            You hold {isLong ? 'a LONG' : 'a SHORT'} of {Math.abs(fromX18(position.amount))} {product.symbol} at an average {usd(entry)}.
            Attach a stop-loss and take-profit that run on Nado while you&apos;re offline. Check &ldquo;My orders&rdquo; first if you may
            already have protection in place.
          </p>
        </div>
      </div>
      <div className="form-row">
        <label className="field">
          <span>Stop-loss %</span>
          <input type="number" min="0.1" step="0.1" value={stopLossPct} onChange={(e) => setStopLossPct(e.target.value)} />
        </label>
        <label className="field">
          <span>Take-profit %</span>
          <input type="number" min="0.1" step="0.1" value={takeProfitPct} onChange={(e) => setTakeProfitPct(e.target.value)} />
        </label>
        <div className="muted" style={{ paddingBottom: '0.6rem' }}>
          Stop {usd(fromX18(tick(stop, 'nearest')))} · Take-profit {usd(fromX18(tick(takeProfit, 'nearest')))}
        </div>
      </div>
      <div className="form-row">
        <button className="btn btn-primary" onClick={protect} disabled={busy}>
          {busy ? 'Confirm the 2 signatures in your wallet…' : 'Set protection'}
        </button>
      </div>
      {message && <div className={`notice ${message.ok ? 'success' : 'error'}`}>{message.text}</div>}
    </div>
  );
}
