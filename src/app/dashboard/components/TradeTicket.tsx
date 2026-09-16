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
  placeLimitOrder,
  placeMarketOrder,
  planLimitOrder,
  planMarketOrder,
  priceInputValue,
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
type OrderKind = 'market' | 'limit';
const usd = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The trading ticket. Market: fill now, with exits added once it fills, sized to the fill. Limit: rest at a chosen price
 * (post-only by default, so it only adds liquidity), with exits that wait for it to fill.
 */
export function TradeTicket({ account, network, sign, sender, product, bid, ask, onTraded }: Props) {
  const [kind, setKind] = useState<OrderKind>('market');
  const [side, setSide] = useState<'long' | 'short'>('long');
  const [sizeMode, setSizeMode] = useState<SizeMode>('usd');
  const [sizeValue, setSizeValue] = useState('250');
  const [limitPrice, setLimitPrice] = useState('');
  const [postOnly, setPostOnly] = useState(true);
  const [days, setDays] = useState('7');
  const [useStop, setUseStop] = useState(true);
  const [stopLoss, setStopLoss] = useState('3');
  const [useTarget, setUseTarget] = useState(false);
  const [takeProfit, setTakeProfit] = useState('6');
  const [stage, setStage] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const long = side === 'long';
  const isLimit = kind === 'limit';
  const base = product.symbol.replace('-PERP', '');
  const tick = product.price_increment_x18;
  // A limit order defaults to joining its own side of the book: the best bid for a buy, the best ask for a sell.
  const defaultLimit = long ? bid : ask;
  const refPrice = (isLimit ? Number(limitPrice) || defaultLimit : long ? ask : bid) ?? 0;
  const stopPercent = useStop || sizeMode === 'risk' ? Number(stopLoss) : null;
  const targetPercent = useTarget ? Number(takeProfit) : null;

  // Holding the other way, this order first reduces that position, so exits for a new position would be misleading.
  const existing = account?.perps[product.product_id]?.amount ?? 0;
  const opposite = (long && existing < 0) || (!long && existing > 0);

  const size = useMemo(() => {
    const value = Number(sizeValue);
    if (!value || !refPrice) return 0;
    if (sizeMode === 'base') return value;
    if (sizeMode === 'usd') return value / refPrice;
    if (!stopPercent) return 0;
    return sizeForRisk(value, refPrice, refPrice * (long ? 1 - stopPercent / 100 : 1 + stopPercent / 100), product.size_increment);
  }, [sizeValue, sizeMode, refPrice, stopPercent, long, product.size_increment]);

  const common = {
    side,
    size,
    bid,
    ask,
    stopLossPercent: opposite ? null : stopPercent,
    takeProfitPercent: opposite ? null : targetPercent,
    priceIncrementX18: BigInt(tick),
    sizeIncrementX18: BigInt(product.size_increment),
    minOrderValueX18: BigInt(product.min_size),
  };
  const market = planMarketOrder(common);
  const limit = planLimitOrder({ ...common, price: refPrice, postOnly });

  const amount = isLimit ? limit.amount : market.amount;
  const lots = Math.abs(fromX18(amount));
  const entryPrice = isLimit ? fromX18(limit.priceX18) : refPrice;
  const stopX18 = isLimit ? (limit.stop?.triggerX18 ?? null) : market.stopX18;
  const targetX18 = isLimit ? (limit.takeProfit?.triggerX18 ?? null) : market.takeProfitX18;
  const exitCount = (stopX18 ? 1 : 0) + (targetX18 ? 1 : 0);
  const errors = [
    ...(isLimit ? limit.errors : market.errors),
    ...(sizeMode === 'risk' && !(Number(stopLoss) > 0) ? ['Sizing by risk needs a stop-loss.'] : []),
  ];
  const warnings = isLimit ? limit.warnings : [];

  const risk =
    account && lots > 0 && entryPrice > 0
      ? assessTradeRisk(account, {
          productId: product.product_id,
          fills: [{ productId: product.product_id, amount: fromX18(amount), price: entryPrice }],
          stopPrice: stopX18 ? fromX18(stopX18) : undefined,
          priceIncrementX18: tick,
        })
      : null;
  const blocked = errors.length > 0 || Boolean(risk?.errors.length) || stage !== null;

  const exitsText = () =>
    [stopX18 && `stop-loss at ${formatPrice(fromX18(stopX18), tick)}`, targetX18 && `take-profit at ${formatPrice(fromX18(targetX18), tick)}`]
      .filter(Boolean)
      .join(' and ');

  async function submitMarket() {
    setStage('Checking your position…');
    const before = extractPerpPosition(await fetchSubaccountInfo(network, sender), product.product_id)?.amount ?? 0n;

    setStage('Confirm the order in your wallet…');
    await placeMarketOrder(network, sign, { productId: product.product_id, sender, plan: market });

    // IOC settles within moments; read the position back to see how much actually filled.
    setStage('Waiting for the fill…');
    let filled = 0n;
    for (let i = 0; i < 8 && filled === 0n; i++) {
      await wait(750);
      const after = extractPerpPosition(await fetchSubaccountInfo(network, sender), product.product_id)?.amount ?? 0n;
      filled = filledAmount(before, after, market.amount);
    }
    if (filled === 0n) {
      setResult({ ok: false, text: `The order didn't fill: there was no liquidity within ${MARKET_SLIPPAGE_PERCENT}% of the price. Nothing was traded.` });
      return;
    }

    const filledSize = Math.abs(fromX18(filled));
    const partial = filled !== market.amount ? ` (${filledSize} of ${lots} ${base} filled)` : '';
    const traded = `${long ? 'Bought' : 'Sold'} ${filledSize} ${base} at about ${formatPrice(market.expectedPrice, tick)}${partial}`;
    track('market_order', network.chainId, filledSize * market.expectedPrice);
    onTraded();

    if (exitCount === 0) {
      setResult({ ok: true, text: `${traded}.` });
      return;
    }
    setStage(`Confirm the ${exitCount === 2 ? 'stop-loss and take-profit' : stopX18 ? 'stop-loss' : 'take-profit'} in your wallet…`);
    try {
      await protectFill(network, sign, { productId: product.product_id, sender, filled, plan: market, priceIncrementX18: BigInt(tick) });
      setResult({ ok: true, text: `${traded}. Your ${exitsText()} ${exitCount === 2 ? 'are' : 'is'} live on Nado.` });
    } catch (e: any) {
      setResult({ ok: false, text: `${traded}, but the exits weren't placed: ${e.shortMessage ?? e.message}. Add them with "Protect open position" below.` });
    }
  }

  async function submitLimit() {
    setStage(exitCount ? `Confirm ${1 + exitCount} signatures in your wallet…` : 'Confirm the order in your wallet…');
    const placed = await placeLimitOrder(network, sign, { productId: product.product_id, sender, plan: limit, expiresInDays: Number(days) || 7 });
    track('limit_order', network.chainId, limit.notional);
    onTraded();
    const order = `${long ? 'Buy' : 'Sell'} limit for ${lots} ${base} at ${formatPrice(fromX18(limit.priceX18), tick)}${postOnly ? ' (post-only)' : ''}`;
    const exits = placed.exits.length ? ` Your ${exitsText()} ${placed.exits.length === 2 ? 'wait' : 'waits'} for it to fill.` : '';
    setResult({
      ok: true,
      text: `${order} is on Nado${limit.crosses ? ' and fills straight away' : ', resting until the price reaches it'}.${exits} Manage it in "My orders" below.`,
    });
  }

  async function submit() {
    if (blocked || lots === 0) return;
    setResult(null);
    try {
      await (isLimit ? submitLimit() : submitMarket());
    } catch (e: any) {
      setResult({ ok: false, text: `Order not placed: ${e.shortMessage ?? e.message}` });
    } finally {
      setStage(null);
    }
  }

  return (
    <div className="glass panel" id="trade-now">
      <div className="panel-header">
        <div>
          <h3>Trade now</h3>
          <p className="muted" style={{ marginTop: '0.4rem', maxWidth: 640 }}>
            {isLimit
              ? `Rest an order at your price on ${product.symbol}, with a stop-loss and take-profit that wait for it to fill.`
              : `Buy or sell ${product.symbol} at the market price, with a stop-loss and take-profit added as soon as it fills.`}
          </p>
        </div>
        <div className="ticket-toggles">
          <div className="segmented" role="radiogroup" aria-label="Order type">
            {(['market', 'limit'] as OrderKind[]).map((k) => (
              <button key={k} role="radio" aria-checked={kind === k} className={`segment ${kind === k ? 'active' : ''}`} onClick={() => {
                  setKind(k);
                  setResult(null);
                }}
              >
                {k === 'market' ? 'Market' : 'Limit'}
              </button>
            ))}
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
      </div>

      <div className="form-row">
        {isLimit && (
          <label className="field">
            <span>Limit price</span>
            <input
              type="number"
              min="0"
              step="any"
              placeholder={defaultLimit ? priceInputValue(defaultLimit, tick) : ''}
              value={limitPrice}
              onChange={(e) => setLimitPrice(e.target.value)}
            />
          </label>
        )}
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
        {isLimit && (
          <label className="field">
            <span>Expires in (days)</span>
            <input type="number" min="1" step="1" value={days} onChange={(e) => setDays(e.target.value)} />
          </label>
        )}
      </div>

      {isLimit && (
        <label className="remind-toggle" style={{ marginTop: '0.75rem' }}>
          <input type="checkbox" checked={postOnly} onChange={(e) => setPostOnly(e.target.checked)} />
          <span>Post-only: only add liquidity. Nado cancels the order rather than let it fill against the book.</span>
        </label>
      )}

      {opposite && (
        <p className="muted" style={{ marginTop: '0.5rem' }}>
          You hold a {existing > 0 ? 'long' : 'short'} on {product.symbol}, so this order reduces it first. Exits aren&apos;t added; manage the
          position in Portfolio.
        </p>
      )}

      {lots > 0 && entryPrice > 0 && (
        <div className="kv">
          <div>
            <span>Order</span>
            {long ? 'Buy' : 'Sell'} {lots} {base} ≈ {usd(lots * entryPrice)}
          </div>
          <div>
            <span>{isLimit ? 'Limit price' : 'Fills near'}</span>
            {isLimit
              ? `${formatPrice(entryPrice, tick)}${postOnly ? ' · post-only' : ''} · expires in ${Number(days) || 7} days`
              : `${formatPrice(entryPrice, tick)}, no worse than ${formatPrice(fromX18(market.limitPriceX18), tick)}`}
          </div>
          {stopX18 && (
            <div>
              <span>Stop-loss at {formatPrice(fromX18(stopX18), tick)}</span>
              <span style={{ color: 'var(--danger)' }}>−{usd(Math.abs(entryPrice - fromX18(stopX18)) * lots)}</span>
            </div>
          )}
          {targetX18 && (
            <div>
              <span>Take-profit at {formatPrice(fromX18(targetX18), tick)}</span>
              <span style={{ color: 'var(--success)' }}>+{usd(Math.abs(fromX18(targetX18) - entryPrice) * lots)}</span>
            </div>
          )}
        </div>
      )}

      {errors.length > 0 && <div className="notice error">{errors[0]}</div>}
      {!errors.length &&
        warnings.map((w) => (
          <div key={w} className="notice warn">
            {w}
          </div>
        ))}
      {lots > 0 && !errors.length && <RiskPreview account={account} risk={risk} productId={product.product_id} priceIncrementX18={tick} />}

      <div className="form-row">
        <button className={`btn ${long ? 'btn-buy' : 'btn-sell'}`} onClick={submit} disabled={blocked || lots === 0}>
          {stage ??
            (isLimit
              ? `Place ${long ? 'buy' : 'sell'} limit${lots > 0 ? ` · ${lots} ${base}` : ''}`
              : `${long ? 'Buy' : 'Sell'} ${lots > 0 ? `${lots} ${base}` : base} now`)}
        </button>
        <span className="muted">
          {1 + exitCount} signature{exitCount ? 's' : ''} ·{' '}
          {isLimit ? (exitCount ? 'exits activate when it fills' : 'rests on the book until filled or cancelled') : 'fills immediately or is cancelled'}
        </span>
      </div>

      {result && <div className={`notice ${result.ok ? 'success' : 'error'}`}>{result.text}</div>}
    </div>
  );
}
