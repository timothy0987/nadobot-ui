'use client';

import { useMemo, useState } from 'react';
import {
  createTradePlan,
  priceTradePlan,
  fromX18,
  type NadoNetwork,
  type ProductSymbol,
  type SignTypedDataAsync,
} from '@/lib/nado';

interface Props {
  network: NadoNetwork;
  sign: SignTypedDataAsync;
  sender: `0x${string}`;
  product: ProductSymbol;
  bid: number | null;
  ask: number | null;
  onCreated: () => void;
}

const usd = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

export function TradePlanForm({ network, sign, sender, product, bid, ask, onCreated }: Props) {
  const [side, setSide] = useState<'long' | 'short'>('long');
  const [size, setSize] = useState('0.002');
  const [entry, setEntry] = useState('');
  const [stopLoss, setStopLoss] = useState('5');
  const [takeProfit, setTakeProfit] = useState('10');
  const [days, setDays] = useState('7');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const input = useMemo(() => {
    const entryPrice = Number(entry);
    if (!entryPrice || !Number(size)) return null;
    return {
      productId: product.product_id,
      sender,
      side,
      size: Number(size),
      entryPrice,
      stopLossPercent: Number(stopLoss),
      takeProfitPercent: Number(takeProfit),
      expiresInDays: Number(days) || 7,
      priceIncrementX18: BigInt(product.price_increment_x18),
      sizeIncrementX18: BigInt(product.size_increment),
    };
  }, [entry, size, side, stopLoss, takeProfit, days, product, sender]);

  const preview = input ? priceTradePlan(input) : null;
  const notional = preview ? Math.abs(fromX18(preview.amount)) * fromX18(preview.entryX18) : 0;
  const minNotional = fromX18(product.min_size);

  // Entering on the wrong side of the market would fill instantly as a taker, which is a market order, not a plan.
  const marketSide = side === 'long' ? ask : bid;
  const warning =
    preview && marketSide && (side === 'long' ? fromX18(preview.entryX18) >= marketSide : fromX18(preview.entryX18) <= marketSide)
      ? `This entry is ${side === 'long' ? 'at or above the ask' : 'at or below the bid'} (${usd(marketSide)}), so it will fill immediately.`
      : notional > 0 && notional < minNotional
        ? `Order value ${usd(notional)} is below this market's ${usd(minNotional)} minimum.`
        : null;

  async function submit() {
    if (!input) return;
    setBusy(true);
    setResult(null);
    try {
      await createTradePlan(network, sign, input);
      setResult({ ok: true, text: 'Plan is live on Nado. You can close this page: the entry, stop-loss and take-profit all run on Nado’s servers.' });
      onCreated();
    } catch (e: any) {
      setResult({ ok: false, text: `Could not create plan: ${e.shortMessage ?? e.message}` });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="glass panel">
      <div className="panel-header">
        <div>
          <h3>New trade plan</h3>
          <p className="muted" style={{ marginTop: '0.4rem', maxWidth: 640 }}>
            Set an entry price with a stop-loss and take-profit. You sign three orders with your own wallet; the exits stay dormant
            until the entry fills. Everything runs on Nado while you&apos;re offline, and no one else ever holds your key.
          </p>
        </div>
        {bid && ask && (
          <span className="pill">
            {product.symbol} bid {usd(bid)} / ask {usd(ask)}
          </span>
        )}
      </div>

      <div className="form-row">
        <label className="field">
          <span>Side</span>
          <select value={side} onChange={(e) => setSide(e.target.value as 'long' | 'short')}>
            <option value="long">Long (buy the dip)</option>
            <option value="short">Short (sell the rally)</option>
          </select>
        </label>
        <label className="field">
          <span>Size ({product.symbol.replace('-PERP', '')})</span>
          <input type="number" min="0" step="any" value={size} onChange={(e) => setSize(e.target.value)} />
        </label>
        <label className="field">
          <span>Entry price</span>
          <input
            type="number"
            min="0"
            step="any"
            placeholder={bid ? (bid * (side === 'long' ? 0.98 : 1.02)).toFixed(0) : ''}
            value={entry}
            onChange={(e) => setEntry(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Stop-loss %</span>
          <input type="number" min="0.1" step="0.1" value={stopLoss} onChange={(e) => setStopLoss(e.target.value)} />
        </label>
        <label className="field">
          <span>Take-profit %</span>
          <input type="number" min="0.1" step="0.1" value={takeProfit} onChange={(e) => setTakeProfit(e.target.value)} />
        </label>
        <label className="field">
          <span>Entry expires (days)</span>
          <input type="number" min="1" step="1" value={days} onChange={(e) => setDays(e.target.value)} />
        </label>
      </div>

      {preview && (
        <div className="kv">
          <div>
            <span>Entry</span>
            {side === 'long' ? 'Buy' : 'Sell'} {Math.abs(fromX18(preview.amount))} @ {usd(fromX18(preview.entryX18))}
          </div>
          <div>
            <span>Stop-loss triggers at</span>
            {usd(fromX18(preview.stopX18))}
          </div>
          <div>
            <span>Take-profit triggers at</span>
            {usd(fromX18(preview.takeProfitX18))}
          </div>
          <div>
            <span>Order value</span>
            {usd(notional)}
          </div>
        </div>
      )}

      {warning && <div className="notice error">{warning}</div>}

      <div className="form-row">
        <button className="btn btn-primary" onClick={submit} disabled={!preview || busy || Boolean(warning)}>
          {busy ? 'Confirm the 3 signatures in your wallet…' : 'Create plan'}
        </button>
      </div>

      {result && <div className={`notice ${result.ok ? 'success' : 'error'}`}>{result.text}</div>}
    </div>
  );
}
