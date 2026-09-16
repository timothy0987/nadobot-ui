'use client';

import { useMemo, useState } from 'react';
import {
  assessTradeRisk,
  extractPerpPosition,
  fetchSubaccountInfo,
  filledAmount,
  formatPrice,
  fromX18,
  MARKET_SLIPPAGE_PERCENT,
  placeMarketOrder,
  planMarketOrder,
  protectFill,
  sizeForRisk,
  type AccountRisk,
  type NadoNetwork,
  type ProductSymbol,
  type SignTypedDataAsync,
} from '@/lib/nado';
import { track } from '@/lib/analytics';
import { RiskPreview } from './RiskPreview';

interface Props {
  account: AccountRisk | null;
  network: NadoNetwork;
  sign: SignTypedDataAsync;
  sender: `0x${string}`;
  product: ProductSymbol;
  bid: number | null;
  ask: number | null;
  onTraded: () => void;
}

type SizeMode = 'usd' | 'base' | 'risk';
const usd = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Buy or sell now at the market, with an optional stop-loss and take-profit added once it fills. The simplest way to
 * trade on Nado from Nadobot: one signature for the order, one more for each exit.
 */
export function TradeTicket({ account, network, sign, sender, product, bid, ask, onTraded }: Props) {
  const [side, setSide] = useState<'long' | 'short'>('long');
  const [sizeMode, setSizeMode] = useState<SizeMode>('usd');
  const [sizeValue, setSizeValue] = useState('250');
  const [useStop, setUseStop] = useState(true);
  const [stopLoss, setStopLoss] = useState('3');
  const [useTarget, setUseTarget] = useState(false);
  const [takeProfit, setTakeProfit] = useState('6');
  const [stage, setStage] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const long = side === 'long';
  const base = product.symbol.replace('-PERP', '');
  const tick = product.price_increment_x18;
  const touch = long ? ask : bid;
  const stopPercent = useStop || sizeMode === 'risk' ? Number(stopLoss) : null;
  const targetPercent = useTarget ? Number(takeProfit) : null;

  // Holding the other way, this order first reduces that position, so exits for a new position would be misleading.
  const existing = account?.perps[product.product_id]?.amount ?? 0;
  const opposite = (long && existing < 0) || (!long && existing > 0);

  const size = useMemo(() => {
    const value = Number(sizeValue);
    if (!value || !touch) return 0;
    if (sizeMode === 'base') return value;
    if (sizeMode === 'usd') return value / touch;
    if (!stopPercent) return 0;
    return sizeForRisk(value, touch, touch * (long ? 1 - stopPercent / 100 : 1 + stopPercent / 100), product.size_increment);
  }, [sizeValue, sizeMode, touch, stopPercent, long, product.size_increment]);

  const plan = planMarketOrder({
    side,
    size,
    bid,
    ask,
    stopLossPercent: opposite ? null : stopPercent,
    takeProfitPercent: opposite ? null : targetPercent,
    priceIncrementX18: BigInt(tick),
    sizeIncrementX18: BigInt(product.size_increment),
    minOrderValueX18: BigInt(product.min_size),
  });
  const lots = Math.abs(fromX18(plan.amount));
  const risk =
    account && lots > 0 && touch
      ? assessTradeRisk(account, {
          productId: product.product_id,
          fills: [{ productId: product.product_id, amount: fromX18(plan.amount), price: touch }],
          stopPrice: plan.stopX18 ? fromX18(plan.stopX18) : undefined,
          priceIncrementX18: tick,
        })
      : null;
  const errors = [...plan.errors, ...(sizeMode === 'risk' && !(Number(stopLoss) > 0) ? ['Sizing by risk needs a stop-loss.'] : [])];
  const blocked = errors.length > 0 || Boolean(risk?.errors.length) || stage !== null;
  const exitCount = (plan.stopX18 ? 1 : 0) + (plan.takeProfitX18 ? 1 : 0);

  async function submit() {
    if (blocked) return;
    setResult(null);
    try {
      setStage('Checking your position…');
      const before = extractPerpPosition(await fetchSubaccountInfo(network, sender), product.product_id)?.amount ?? 0n;

      setStage('Confirm the order in your wallet…');
      await placeMarketOrder(network, sign, { productId: product.product_id, sender, plan });

      // IOC settles within moments; read the position back to see how much actually filled.
      setStage('Waiting for the fill…');
      let filled = 0n;
      for (let i = 0; i < 8 && filled === 0n; i++) {
        await wait(750);
        const after = extractPerpPosition(await fetchSubaccountInfo(network, sender), product.product_id)?.amount ?? 0n;
        filled = filledAmount(before, after, plan.amount);
      }
      if (filled === 0n) {
        setResult({ ok: false, text: `The order didn't fill: there was no liquidity within ${MARKET_SLIPPAGE_PERCENT}% of the price. Nothing was traded.` });
        return;
      }

      const filledSize = Math.abs(fromX18(filled));
      const partial = filled !== plan.amount ? ` (${filledSize} of ${lots} ${base} filled)` : '';
      track('market_order', network.chainId, filledSize * plan.expectedPrice);
      onTraded();

      if (exitCount === 0) {
        setResult({ ok: true, text: `${long ? 'Bought' : 'Sold'} ${filledSize} ${base} at about ${formatPrice(plan.expectedPrice, tick)}${partial}.` });
        return;
      }
      setStage(`Confirm the ${exitCount === 2 ? 'stop-loss and take-profit' : plan.stopX18 ? 'stop-loss' : 'take-profit'} in your wallet…`);
      try {
        await protectFill(network, sign, { productId: product.product_id, sender, filled, plan, priceIncrementX18: BigInt(tick) });
        const exits = [plan.stopX18 && `stop-loss at ${formatPrice(fromX18(plan.stopX18), tick)}`, plan.takeProfitX18 && `take-profit at ${formatPrice(fromX18(plan.takeProfitX18), tick)}`]
          .filter(Boolean)
          .join(' and ');
        setResult({ ok: true, text: `${long ? 'Bought' : 'Sold'} ${filledSize} ${base} at about ${formatPrice(plan.expectedPrice, tick)}${partial}. Your ${exits} ${exitCount === 2 ? 'are' : 'is'} live on Nado.` });
      } catch (e: any) {
        setResult({
          ok: false,
          text: `${long ? 'Bought' : 'Sold'} ${filledSize} ${base}${partial}, but the exits weren't placed: ${e.shortMessage ?? e.message}. Add them with "Protect open position" below.`,
        });
      }
    } catch (e: any) {
      setResult({ ok: false, text: `Order not placed: ${e.shortMessage ?? e.message}` });
    } finally {
      setStage(null);
    }
  }

  return (
    <div className="glass panel">
      <div className="panel-header">
        <div>
          <h3>Trade now</h3>
          <p className="muted" style={{ marginTop: '0.4rem', maxWidth: 640 }}>
            Buy or sell {product.symbol} at the market price, with a stop-loss and take-profit added as soon as it fills.
          </p>
        </div>
        <div className="segmented" role="radiogroup" aria-label="Side">
          <button role="radio" aria-checked={long} className={`segment ${long ? 'active buy' : ''}`} onClick={() => setSide('long')}>
            Buy / Long
          </button>
          <button role="radio" aria-checked={!long} className={`segment ${!long ? 'active sell' : ''}`} onClick={() => setSide('short')}>
            Sell / Short
          </button>
        </div>
      </div>

      <div className="form-row">
        <label className="field">
          <span>Size by</span>
          <select
            value={sizeMode}
            onChange={(e) => {
              const mode = e.target.value as SizeMode;
              setSizeMode(mode);
              setSizeValue(mode === 'usd' ? '250' : mode === 'risk' ? '10' : '');
              if (mode === 'risk') setUseStop(true);
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
          <span className="check-label">
            <input type="checkbox" checked={useStop || sizeMode === 'risk'} disabled={sizeMode === 'risk' || opposite} onChange={(e) => setUseStop(e.target.checked)} /> Stop-loss %
          </span>
          <input type="number" min="0.1" step="0.1" value={stopLoss} disabled={!(useStop || sizeMode === 'risk') || opposite} onChange={(e) => setStopLoss(e.target.value)} />
        </label>
        <label className="field">
          <span className="check-label">
            <input type="checkbox" checked={useTarget} disabled={opposite} onChange={(e) => setUseTarget(e.target.checked)} /> Take-profit %
          </span>
          <input type="number" min="0.1" step="0.1" value={takeProfit} disabled={!useTarget || opposite} onChange={(e) => setTakeProfit(e.target.value)} />
        </label>
      </div>

      {opposite && (
        <p className="muted" style={{ marginTop: '0.5rem' }}>
          You hold a {existing > 0 ? 'long' : 'short'} on {product.symbol}, so this order reduces it first. Exits aren&apos;t added; manage the
          position in Portfolio.
        </p>
      )}

      {lots > 0 && touch && (
        <div className="kv">
          <div>
            <span>Order</span>
            {long ? 'Buy' : 'Sell'} {lots} {base} ≈ {usd(plan.notional)}
          </div>
          <div>
            <span>Fills near</span>
            {formatPrice(touch, tick)}, no worse than {formatPrice(fromX18(plan.limitPriceX18), tick)}
          </div>
          {plan.stopX18 && (
            <div>
              <span>Stop-loss at {formatPrice(fromX18(plan.stopX18), tick)}</span>
              <span style={{ color: 'var(--danger)' }}>−{usd(Math.abs(touch - fromX18(plan.stopX18)) * lots)}</span>
            </div>
          )}
          {plan.takeProfitX18 && (
            <div>
              <span>Take-profit at {formatPrice(fromX18(plan.takeProfitX18), tick)}</span>
              <span style={{ color: 'var(--success)' }}>+{usd(Math.abs(fromX18(plan.takeProfitX18) - touch) * lots)}</span>
            </div>
          )}
        </div>
      )}

      {errors.length > 0 && <div className="notice error">{errors[0]}</div>}
      {lots > 0 && !errors.length && <RiskPreview account={account} risk={risk} productId={product.product_id} priceIncrementX18={tick} />}

      <div className="form-row">
        <button className={`btn ${long ? 'btn-buy' : 'btn-sell'}`} onClick={submit} disabled={blocked || lots === 0}>
          {stage ?? `${long ? 'Buy' : 'Sell'} ${lots > 0 ? `${lots} ${base}` : base} now`}
        </button>
        <span className="muted">
          {1 + exitCount} signature{exitCount ? 's' : ''} · fills immediately or is cancelled
        </span>
      </div>

      {result && <div className={`notice ${result.ok ? 'success' : 'error'}`}>{result.text}</div>}
    </div>
  );
}
