'use client';

import { useMemo, useState } from 'react';
import {
  assessTradeRisk,
  createTradePlan,
  formatPrice,
  fromX18,
  priceInputValue,
  priceTradePlan,
  sizeForRisk,
  type AccountRisk,
  type NadoNetwork,
  type ProductSymbol,
  type SignTypedDataAsync,
} from '@/lib/nado';
import { RiskPreview } from './RiskPreview';

interface Props {
  account: AccountRisk | null;
  network: NadoNetwork;
  sign: SignTypedDataAsync;
  sender: `0x${string}`;
  product: ProductSymbol;
  bid: number | null;
  ask: number | null;
  onCreated: () => void;
}

type SizeMode = 'usd' | 'base' | 'risk';

const usd = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

export function TradePlanForm({ account, network, sign, sender, product, bid, ask, onCreated }: Props) {
  const [side, setSide] = useState<'long' | 'short'>('long');
  const [sizeMode, setSizeMode] = useState<SizeMode>('usd');
  const [sizeValue, setSizeValue] = useState('500');
  const [entry, setEntry] = useState('');
  const [stopLoss, setStopLoss] = useState('5');
  const [takeProfit, setTakeProfit] = useState('10');
  const [days, setDays] = useState('7');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const isLong = side === 'long';
  const base = product.symbol.replace('-PERP', '');
  const tick = product.price_increment_x18;
  const price = (n: number) => formatPrice(n, tick);
  // Suggested entry: 2% past the market, so the plan waits for a better price instead of filling immediately.
  const defaultEntry = isLong ? (bid ? bid * 0.98 : 0) : ask ? ask * 1.02 : 0;
  const entryPrice = Number(entry) || defaultEntry;
  const stopPercent = Number(stopLoss);
  const stopPrice = entryPrice * (isLong ? 1 - stopPercent / 100 : 1 + stopPercent / 100);

  // Size in the market's base asset, from whichever unit the trader typed.
  const size = useMemo(() => {
    const value = Number(sizeValue);
    if (!value || !entryPrice) return 0;
    if (sizeMode === 'base') return value;
    if (sizeMode === 'usd') return value / entryPrice;
    return sizeForRisk(value, entryPrice, stopPrice, product.size_increment);
  }, [sizeValue, sizeMode, entryPrice, stopPrice, product.size_increment]);

  const input = useMemo(() => {
    if (!entryPrice || !size) return null;
    return {
      productId: product.product_id,
      sender,
      side,
      size,
      entryPrice,
      stopLossPercent: stopPercent,
      takeProfitPercent: Number(takeProfit),
      expiresInDays: Number(days) || 7,
      priceIncrementX18: BigInt(product.price_increment_x18),
      sizeIncrementX18: BigInt(product.size_increment),
    };
  }, [entryPrice, size, side, stopPercent, takeProfit, days, product, sender]);

  const preview = input ? priceTradePlan(input) : null;
  const lots = preview ? Math.abs(fromX18(preview.amount)) : 0;
  const entryX18Price = preview ? fromX18(preview.entryX18) : 0;
  const notional = lots * entryX18Price;
  const minNotional = fromX18(product.min_size);
  const lossAtStop = preview ? Math.abs(entryX18Price - fromX18(preview.stopX18)) * lots : 0;
  const profitAtTarget = preview ? Math.abs(fromX18(preview.takeProfitX18) - entryX18Price) * lots : 0;

  const risk =
    account && preview && lots > 0
      ? assessTradeRisk(account, {
          productId: product.product_id,
          fills: [{ productId: product.product_id, amount: isLong ? lots : -lots, price: entryX18Price }],
          stopPrice: fromX18(preview.stopX18),
          priceIncrementX18: tick,
        })
      : null;

  // Entering on the wrong side of the market would fill instantly as a taker, which is a market order, not a plan.
  const marketSide = isLong ? ask : bid;
  const warning = !(stopPercent > 0 && stopPercent < 100)
    ? 'Enter a stop-loss between 0 and 100%.'
    : preview && lots === 0
      ? `Size is below this market's minimum lot size.`
      : preview && marketSide && (isLong ? entryX18Price >= marketSide : entryX18Price <= marketSide)
        ? `This entry is ${isLong ? 'at or above the ask' : 'at or below the bid'} (${price(marketSide)}), so it will fill immediately.`
        : notional > 0 && notional < minNotional
          ? `Order value ${usd(notional)} is below this market's ${usd(minNotional)} minimum.${sizeMode === 'risk' ? ' Risk a larger amount or use a tighter stop-loss.' : ''}`
          : null;
  const blocked = Boolean(warning) || Boolean(risk?.errors.length);

  async function submit() {
    if (!input || blocked) return;
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
            {product.symbol} bid {price(bid)} / ask {price(ask)}
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
          <span>Size by</span>
          <select
            value={sizeMode}
            onChange={(e) => {
              const mode = e.target.value as SizeMode;
              setSizeMode(mode);
              setSizeValue(mode === 'usd' ? '500' : mode === 'risk' ? '25' : '');
            }}
          >
            <option value="usd">Amount in USD</option>
            <option value="base">Amount in {base}</option>
            <option value="risk">Risk: max loss in USD</option>
          </select>
        </label>
        <label className="field">
          <span>{sizeMode === 'risk' ? 'Lose at most (USD)' : sizeMode === 'usd' ? 'Amount (USD)' : `Size (${base})`}</span>
          <input type="number" min="0" step="any" value={sizeValue} onChange={(e) => setSizeValue(e.target.value)} />
        </label>
        <label className="field">
          <span>Entry price</span>
          <input
            type="number"
            min="0"
            step="any"
            placeholder={defaultEntry ? priceInputValue(defaultEntry, tick) : ''}
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

      {sizeMode === 'risk' && (
        <p className="muted" style={{ marginTop: '0.5rem' }}>
          Nadobot sizes the position so that if the stop-loss is hit, you lose about the amount you entered, before fees.
        </p>
      )}

      {preview && lots > 0 && (
        <div className="kv">
          <div>
            <span>Entry</span>
            {isLong ? 'Buy' : 'Sell'} {lots} {base} @ {price(entryX18Price)}
          </div>
          <div>
            <span>Order value</span>
            {usd(notional)}
          </div>
          <div>
            <span>Stop-loss at {price(fromX18(preview.stopX18))}</span>
            <span style={{ color: 'var(--danger)' }}>−{usd(lossAtStop)}</span>
          </div>
          <div>
            <span>Take-profit at {price(fromX18(preview.takeProfitX18))}</span>
            <span style={{ color: 'var(--success)' }}>+{usd(profitAtTarget)}</span>
          </div>
        </div>
      )}

      {warning && <div className="notice error">{warning}</div>}
      {preview && lots > 0 && !warning && (
        <RiskPreview account={account} risk={risk} productId={product.product_id} priceIncrementX18={tick} />
      )}

      <div className="form-row">
        <button className="btn btn-primary" onClick={submit} disabled={!preview || busy || blocked}>
          {busy ? 'Confirm the 3 signatures in your wallet…' : 'Create plan'}
        </button>
      </div>

      {result && <div className={`notice ${result.ok ? 'success' : 'error'}`}>{result.text}</div>}
    </div>
  );
}
