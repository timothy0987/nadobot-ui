'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  assessTradeRisk,
  cancelLadder,
  formatPrice,
  fromX18,
  LADDER_MAX_RUNGS,
  LADDER_MAX_TAKE_PROFITS,
  LadderPlacementError,
  openLadderRungs,
  placeLadder,
  planLadder,
  priceInputValue,
  type AccountRisk,
  type LadderInput,
  type NadoNetwork,
  type PlacedOrder,
  type ProductSymbol,
  type SignTypedDataAsync,
} from '@/lib/nado';
import { track } from '@/lib/analytics';
import { RiskPreview } from './RiskPreview';
import { restingPrice, type Preset } from '@/lib/presets';

interface Props {
  /** A quick strategy to fill the form with; ignored unless it is for this tool. */
  preset?: { preset: Preset; nonce: number } | null;
  account: AccountRisk | null;
  network: NadoNetwork;
  sign: SignTypedDataAsync;
  sender: `0x${string}`;
  product: ProductSymbol;
  bid: number | null;
  ask: number | null;
  onCreated: () => void;
}

export interface SavedLadder {
  id: string;
  chainId: number;
  sender: string;
  productId: number;
  symbol: string;
  side: 'long' | 'short';
  size: number;
  rungs: number;
  averageEntry: number;
  orders: PlacedOrder[];
  /** False when a signature was rejected partway and only some orders were placed. */
  complete: boolean;
  createdAt: number;
}

const STORAGE_KEY = 'nadobot:ladders';
const usd = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const abs = (v: bigint) => Math.abs(fromX18(v));

export function loadLadders(): SavedLadder[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
  } catch {
    return [];
  }
}

function saveLadders(list: SavedLadder[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, 30)));
  } catch {}
}

/** Labels for My orders: which ladder, and which rung, an order belongs to. */
export function ladderRoles(chainId: number, sender: string) {
  const roles = new Map<string, { ladder: SavedLadder; label: string; firstRung: boolean }>();
  for (const ladder of loadLadders()) {
    if (ladder.chainId !== chainId || ladder.sender !== sender) continue;
    let rung = 0;
    let tp = 0;
    for (const o of ladder.orders) {
      const label =
        o.role === 'rung' ? `Ladder entry ${++rung} of ${ladder.rungs}` : o.role === 'stop' ? 'Ladder stop-loss' : `Ladder take-profit ${++tp}`;
      roles.set(o.digest.toLowerCase(), { ladder, label, firstRung: o.role === 'rung' && rung === 1 });
    }
  }
  return roles;
}

const DEFAULT_TAKE_PROFITS = [
  { percent: '3', share: '50' },
  { percent: '6', share: '30' },
  { percent: '10', share: '20' },
];

/**
 * Laddered entry: several limit orders spread across a price range, so the trader builds a position as price moves
 * instead of betting on one level. Scaled take-profits close it in parts, and one stop-loss protects the whole ladder.
 */
export function LadderForm({ account, network, sign, sender, product, bid, ask, onCreated, preset }: Props) {
  const [side, setSide] = useState<'long' | 'short'>('long');
  const [unit, setUnit] = useState<'usd' | 'base' | 'risk'>('usd');
  const [amount, setAmount] = useState('1000');
  const [rungs, setRungs] = useState('4');
  const [nearPrice, setNearPrice] = useState('');
  const [farPrice, setFarPrice] = useState('');
  const [distribution, setDistribution] = useState<'even' | 'weighted'>('even');
  const [stopLoss, setStopLoss] = useState('5');
  const [takeProfits, setTakeProfits] = useState(DEFAULT_TAKE_PROFITS);
  const [days, setDays] = useState('7');
  const [progress, setProgress] = useState<{ signed: number; total: number } | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string; rollback?: SavedLadder } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const appliedPreset = useRef<number | null>(null);

  useEffect(() => {
    const p = preset?.preset;
    if (!p || p.tool !== 'ladder' || !bid || !ask || appliedPreset.current === preset!.nonce) return;
    appliedPreset.current = preset!.nonce;
    const tick = product.price_increment_x18;
    setSide(p.side);
    setUnit('usd');
    setAmount(String(p.totalUsd));
    setRungs(String(p.rungs));
    setNearPrice(priceInputValue(restingPrice(p.side, bid, ask, p.nearOffsetPercent), tick));
    setFarPrice(priceInputValue(restingPrice(p.side, bid, ask, p.farOffsetPercent), tick));
    setDistribution(p.distribution);
    setStopLoss(String(p.stopLossPercent));
    setTakeProfits(p.takeProfits.map((t) => ({ percent: String(t.percent), share: String(t.share) })));
    setMessage({ ok: true, text: `Filled in from "${p.title}". Check every order and the risk below, adjust anything you like, then place the ladder.` });
    panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [preset, bid, ask, product.price_increment_x18]);
  const [saved, setSaved] = useState<SavedLadder[]>([]);

  useEffect(() => setSaved(loadLadders()), []);

  const isLong = side === 'long';
  const base = product.symbol.replace('-PERP', '');
  const tick = product.price_increment_x18;
  const price = (n: number) => formatPrice(n, tick);
  // Defaults: start 1% past the market and step 5% deep, so the ladder rests on the book instead of filling at once.
  const market = isLong ? bid : ask;
  const defaultNear = market ? market * (isLong ? 0.99 : 1.01) : 0;
  const defaultFar = market ? market * (isLong ? 0.95 : 1.05) : 0;
  const near = Number(nearPrice) || defaultNear;
  const far = Number(farPrice) || defaultFar;

  const input: LadderInput | null = useMemo(() => {
    const value = Number(amount);
    if (!value || !near) return null;
    const n = Math.max(Math.floor(Number(rungs) || 1), 1);
    // A USD amount is converted at the size-weighted average rung price, so the ladder costs what was typed. A risk amount
    // becomes the size that loses that much if every entry fills and the stop is hit.
    const weights = Array.from({ length: n }, (_, i) => (distribution === 'weighted' ? i + 1 : 1));
    const avgPrice =
      n > 1 ? weights.reduce((a, w, i) => a + w * (near + ((far - near) * i) / (n - 1)), 0) / weights.reduce((a, b) => a + b, 0) : near;
    return {
      productId: product.product_id,
      sender,
      side,
      totalSize: unit === 'usd' ? value / avgPrice : unit === 'risk' ? value / (avgPrice * (Number(stopLoss) / 100) || Infinity) : value,
      rungs: Number(rungs),
      nearPrice: near,
      farPrice: far,
      distribution,
      stopLossPercent: Number(stopLoss),
      takeProfits: takeProfits.map((t) => ({ percent: Number(t.percent), sharePercent: Number(t.share) })),
      expiresInDays: Number(days) || 7,
      bid,
      ask,
      priceIncrementX18: BigInt(product.price_increment_x18),
      sizeIncrementX18: BigInt(product.size_increment),
      minOrderValueX18: BigInt(product.min_size),
    };
  }, [amount, near, far, rungs, distribution, product, sender, side, unit, stopLoss, takeProfits, days, bid, ask]);

  const plan = input ? planLadder(input) : null;
  const size = plan ? abs(plan.amount) : 0;
  const stopPrice = plan ? fromX18(plan.stop.triggerX18) : 0;
  const maxLoss = plan ? Math.abs(plan.averageEntry - stopPrice) * size : 0;
  const allTargets = plan ? plan.takeProfits.reduce((a, t) => a + Math.abs(fromX18(t.triggerX18) - plan.averageEntry) * abs(t.amount), 0) : 0;
  const busy = progress !== null;
  const risk =
    account && plan && size > 0 && plan.rungs.every((r) => r.priceX18 > 0n)
      ? assessTradeRisk(account, {
          productId: product.product_id,
          fills: plan.rungs.map((r) => ({ productId: product.product_id, amount: fromX18(r.amount), price: fromX18(r.priceX18) })),
          stopPrice,
          priceIncrementX18: tick,
        })
      : null;
  const blocked = !plan || plan.errors.length > 0 || Boolean(risk?.errors.length);

  function persist(ladder: SavedLadder) {
    const next = [ladder, ...loadLadders().filter((l) => l.id !== ladder.id)];
    saveLadders(next);
    setSaved(next);
  }

  async function submit() {
    if (!input || !plan || blocked) return;
    setMessage(null);
    setProgress({ signed: 0, total: plan.signatures });
    const record = (orders: PlacedOrder[], complete: boolean): SavedLadder => ({
      id: orders[0]?.digest ?? String(Date.now()),
      chainId: network.chainId,
      sender,
      productId: product.product_id,
      symbol: product.symbol,
      side,
      size,
      rungs: plan.rungs.length,
      averageEntry: plan.averageEntry,
      orders,
      complete,
      createdAt: Date.now(),
    });
    try {
      const { placed } = await placeLadder(network, sign, input, (signed, total) => setProgress({ signed, total }));
      track('ladder_placed', network.chainId, plan.rungs.reduce((sum, r) => sum + abs(r.amount) * fromX18(r.priceX18), 0));
      persist(record(placed, true));
      setMessage({
        ok: true,
        text: `Ladder is live: ${plan.rungs.length} entries resting on Nado with a stop-loss and ${plan.takeProfits.length} take-profit${plan.takeProfits.length > 1 ? 's' : ''}. It all runs on Nado's servers, so you can close this page.`,
      });
      onCreated();
    } catch (e: any) {
      const placed = e instanceof LadderPlacementError ? e.placed : [];
      if (placed.length === 0) {
        setMessage({ ok: false, text: `Nothing was placed: ${e.message}` });
      } else {
        const partial = record(placed, false);
        persist(partial);
        const rungsPlaced = placed.filter((o) => o.role === 'rung').length;
        const exitsPlaced = placed.length - rungsPlaced;
        setMessage({
          ok: false,
          text: `Stopped after ${placed.length} of ${plan.signatures} orders (${rungsPlaced} ${rungsPlaced === 1 ? 'entry' : 'entries'}, ${exitsPlaced} exit${exitsPlaced === 1 ? '' : 's'}): ${e.message}. ${exitsPlaced === 0 ? 'The first entry has no stop-loss yet. ' : ''}Roll back to cancel what was placed, or keep it and manage it below.`,
          rollback: partial,
        });
      }
    } finally {
      setProgress(null);
    }
  }

  const updateTakeProfit = (i: number, key: 'percent' | 'share', value: string) =>
    setTakeProfits((list) => list.map((t, j) => (j === i ? { ...t, [key]: value } : t)));

  const mine = saved.filter((l) => l.chainId === network.chainId && l.sender === sender && l.productId === product.product_id);

  return (
    <div className="glass panel" ref={panelRef}>
      <div className="panel-header">
        <div>
          <h3>Ladder &amp; scaled take-profits</h3>
          <p className="muted" style={{ marginTop: '0.4rem', maxWidth: 680 }}>
            Spread your entry across several prices instead of one, then take profit in steps. One stop-loss covers the whole ladder.
            Every order runs on Nado while you&apos;re offline, and you sign each one with your own wallet.
          </p>
        </div>
        <div className="segmented" role="radiogroup" aria-label="Size distribution">
          {(['even', 'weighted'] as const).map((d) => (
            <button key={d} role="radio" aria-checked={distribution === d} className={`segment ${distribution === d ? 'active' : ''}`} onClick={() => setDistribution(d)}>
              {d === 'even' ? 'Even' : 'Weighted'}
            </button>
          ))}
        </div>
      </div>

      <div className="form-row">
        <label className="field">
          <span>Side</span>
          <select value={side} onChange={(e) => setSide(e.target.value as 'long' | 'short')}>
            <option value="long">Long (buy lower)</option>
            <option value="short">Short (sell higher)</option>
          </select>
        </label>
        <label className="field">
          <span>{unit === 'risk' ? 'Lose at most (USD)' : 'Total amount'}</span>
          <input type="number" min="0" step="any" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <label className="field">
          <span>Size by</span>
          <select
            value={unit}
            onChange={(e) => {
              const next = e.target.value as 'usd' | 'base' | 'risk';
              setUnit(next);
              setAmount(next === 'usd' ? '1000' : next === 'risk' ? '50' : '');
            }}
          >
            <option value="usd">USD</option>
            <option value="base">{base}</option>
            <option value="risk">Risk (max loss)</option>
          </select>
        </label>
        <label className="field">
          <span>Entries</span>
          <input type="number" min="1" max={LADDER_MAX_RUNGS} step="1" value={rungs} onChange={(e) => setRungs(e.target.value)} />
        </label>
        <label className="field">
          <span>First entry price</span>
          <input type="number" min="0" step="any" placeholder={defaultNear ? priceInputValue(defaultNear, tick) : ''} value={nearPrice} onChange={(e) => setNearPrice(e.target.value)} />
        </label>
        <label className="field">
          <span>Last entry price</span>
          <input
            type="number"
            min="0"
            step="any"
            disabled={Number(rungs) <= 1}
            placeholder={defaultFar ? priceInputValue(defaultFar, tick) : ''}
            value={farPrice}
            onChange={(e) => setFarPrice(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Stop-loss % from avg entry</span>
          <input type="number" min="0.1" step="0.1" value={stopLoss} onChange={(e) => setStopLoss(e.target.value)} />
        </label>
        <label className="field">
          <span>Entries expire (days)</span>
          <input type="number" min="1" step="1" value={days} onChange={(e) => setDays(e.target.value)} />
        </label>
      </div>

      <h4 style={{ marginTop: '1.25rem', marginBottom: '0.25rem' }}>Take-profit targets</h4>
      <p className="muted" style={{ marginBottom: '0.5rem' }}>
        Distance from your average entry, and how much of the ladder each target closes. Shares add up to 100%.
      </p>
      <div className="tp-grid" role="group" aria-label="Take-profit targets">
        <span className="muted">Target</span>
        <span className="muted">% from avg entry</span>
        <span className="muted">Closes % of ladder</span>
        <span />
        {takeProfits.map((t, i) => (
          <div className="tp-row" key={i}>
            <span>{i + 1}</span>
            <input
              type="number"
              min="0.1"
              step="0.1"
              aria-label={`Target ${i + 1} distance from average entry, percent`}
              value={t.percent}
              onChange={(e) => updateTakeProfit(i, 'percent', e.target.value)}
            />
            <input
              type="number"
              min="1"
              max="100"
              step="1"
              aria-label={`Target ${i + 1} share of ladder, percent`}
              value={t.share}
              onChange={(e) => updateTakeProfit(i, 'share', e.target.value)}
            />
            {takeProfits.length > 1 ? (
              <button className="btn btn-secondary btn-sm" onClick={() => setTakeProfits((list) => list.filter((_, j) => j !== i))} aria-label={`Remove target ${i + 1}`} title="Remove target">
                ✕
              </button>
            ) : (
              <span />
            )}
          </div>
        ))}
      </div>
      {takeProfits.length < LADDER_MAX_TAKE_PROFITS && (
        <button
          className="btn btn-secondary btn-sm"
          style={{ marginTop: '0.5rem' }}
          onClick={() => setTakeProfits((list) => [...list, { percent: String((Number(list[list.length - 1]?.percent) || 0) + 5), share: '10' }])}
        >
          Add target
        </button>
      )}

      {plan && plan.rungs.every((r) => r.priceX18 > 0n) && (
        <>
          <div className="table-scroll" style={{ marginTop: '1.25rem' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Side</th>
                  <th>Size ({base})</th>
                  <th>Price</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                {plan.rungs.map((r, i) => (
                  <tr key={`rung-${i}`}>
                    <td>Entry {i + 1}</td>
                    <td style={{ color: isLong ? 'var(--success)' : 'var(--danger)' }}>{isLong ? 'Buy' : 'Sell'}</td>
                    <td>{abs(r.amount)}</td>
                    <td>{price(fromX18(r.priceX18))}</td>
                    <td>{usd(abs(r.amount) * fromX18(r.priceX18))}</td>
                  </tr>
                ))}
                {plan.takeProfits.map((t, i) => (
                  <tr key={`tp-${i}`}>
                    <td>Take-profit {i + 1}</td>
                    <td style={{ color: isLong ? 'var(--danger)' : 'var(--success)' }}>{isLong ? 'Sell' : 'Buy'}</td>
                    <td>{abs(t.amount)}</td>
                    <td>
                      {isLong ? '≥' : '≤'} {price(fromX18(t.triggerX18))}
                    </td>
                    <td>{usd(abs(t.amount) * fromX18(t.triggerX18))}</td>
                  </tr>
                ))}
                <tr>
                  <td>Stop-loss</td>
                  <td style={{ color: isLong ? 'var(--danger)' : 'var(--success)' }}>{isLong ? 'Sell' : 'Buy'}</td>
                  <td>{size}</td>
                  <td>
                    {isLong ? '≤' : '≥'} {price(stopPrice)}
                  </td>
                  <td>{usd(size * stopPrice)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="kv">
            <div>
              <span>Average entry if all fill</span>
              {price(plan.averageEntry)}
            </div>
            <div>
              <span>Loss at stop (all filled)</span>
              <span style={{ color: 'var(--danger)' }}>−{usd(maxLoss)}</span>
            </div>
            <div>
              <span>Profit if every target hits</span>
              <span style={{ color: 'var(--success)' }}>+{usd(allTargets)}</span>
            </div>
            <div>
              <span>Signatures</span>
              {plan.signatures} (one per order)
            </div>
          </div>
          <p className="muted" style={{ marginTop: '0.5rem' }}>
            Estimates before fees. Exits are sized for the full ladder and are reduce-only, so if only part of it fills, the first target
            closes up to what you hold and never opens a position the other way.
          </p>
        </>
      )}

      {plan?.errors.length ? <div className="notice error">{plan.errors[0]}</div> : null}
      {plan && !plan.errors.length && size > 0 && (
        <RiskPreview account={account} risk={risk} productId={product.product_id} priceIncrementX18={tick} />
      )}

      <div className="form-row">
        <button className="btn btn-primary" onClick={submit} disabled={blocked || busy}>
          {progress
            ? `Signature ${Math.min(progress.signed + 1, progress.total)} of ${progress.total}: confirm in your wallet…`
            : plan
              ? `Place ladder (${plan.signatures} signatures)`
              : 'Place ladder'}
        </button>
      </div>

      {message && (
        <div className={`notice ${message.ok ? 'success' : 'error'}`}>
          {message.text}
          {message.rollback && (
            <LadderActions
              ladder={message.rollback}
              network={network}
              sign={sign}
              sender={sender}
              onDone={() => setMessage({ ok: true, text: 'Rolled back: the placed orders were cancelled.' })}
              rollbackOnly
            />
          )}
        </div>
      )}

      {mine.length > 0 && (
        <>
          <h4 style={{ marginTop: '1.75rem', marginBottom: '0.5rem' }}>Your ladders</h4>
          <ul className="activity">
            {mine.slice(0, 8).map((l) => (
              <LadderRow
                key={l.id}
                ladder={l}
                network={network}
                sign={sign}
                sender={sender}
                onHide={() => {
                  const next = loadLadders().filter((x) => x.id !== l.id);
                  saveLadders(next);
                  setSaved(next);
                }}
              />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function LadderActions({
  ladder,
  network,
  sign,
  sender,
  onDone,
  rollbackOnly = false,
  hasOpenRungs = true,
}: {
  ladder: SavedLadder;
  network: NadoNetwork;
  sign: SignTypedDataAsync;
  sender: `0x${string}`;
  onDone: () => void;
  rollbackOnly?: boolean;
  hasOpenRungs?: boolean;
}) {
  const [working, setWorking] = useState<'rungs' | 'all' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(includeExits: boolean) {
    setWorking(includeExits ? 'all' : 'rungs');
    setError(null);
    try {
      await cancelLadder(network, sign, sender, ladder.productId, ladder.orders, includeExits);
      onDone();
    } catch (e: any) {
      setError(e.shortMessage ?? e.message);
    } finally {
      setWorking(null);
    }
  }

  return (
    <div className="form-row" style={{ marginTop: '0.5rem', alignItems: 'center' }}>
      {!rollbackOnly && hasOpenRungs && (
        <button className="btn btn-secondary btn-sm" onClick={() => run(false)} disabled={working !== null} title="Keeps the stop-loss and take-profits on whatever already filled">
          {working === 'rungs' ? 'Cancelling…' : 'Cancel unfilled entries'}
        </button>
      )}
      <button className="btn btn-secondary btn-sm" onClick={() => run(true)} disabled={working !== null}>
        {working === 'all' ? 'Cancelling…' : rollbackOnly ? 'Roll back' : 'Cancel entries and exits'}
      </button>
      {error && <span className="muted">Cancel failed: {error}</span>}
    </div>
  );
}

function LadderRow({
  ladder,
  network,
  sign,
  sender,
  onHide,
}: {
  ladder: SavedLadder;
  network: NadoNetwork;
  sign: SignTypedDataAsync;
  sender: `0x${string}`;
  onHide: () => void;
}) {
  const [open, setOpen] = useState<number | null>(null);
  const rungsPlaced = ladder.orders.filter((o) => o.role === 'rung').length;
  const exits = ladder.orders.length - rungsPlaced;

  const load = useCallback(
    () =>
      openLadderRungs(network, sender, ladder.productId, ladder.orders)
        .then((r) => setOpen(r.length))
        .catch(() => {}),
    [network, sender, ladder]
  );

  useEffect(() => {
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [load]);

  const settled = rungsPlaced - (open ?? 0);

  return (
    <li className={ladder.complete ? '' : 'warn'} style={{ alignItems: 'flex-start' }}>
      <span className="activity-dot" aria-hidden />
      <div style={{ flex: 1 }}>
        <p>
          {ladder.side === 'long' ? 'Long' : 'Short'} ladder · {ladder.size} {ladder.symbol.replace('-PERP', '')} · avg {formatPrice(ladder.averageEntry)}
          {ladder.complete ? '' : ` · partial (${rungsPlaced} of ${ladder.rungs} entries placed)`}
        </p>
        <div className="progress" aria-hidden>
          <div style={{ width: `${rungsPlaced ? (settled / rungsPlaced) * 100 : 0}%` }} />
        </div>
        <span className="muted">
          {open === null
            ? 'Checking entries…'
            : `${open} of ${rungsPlaced} entries resting · ${settled} filled, cancelled or expired · ${exits} exit order${exits === 1 ? '' : 's'}`}{' '}
          · started {new Date(ladder.createdAt).toLocaleString()}
        </span>
        {open !== null && (
          <LadderActions ladder={ladder} network={network} sign={sign} sender={sender} onDone={() => setTimeout(load, 2500)} hasOpenRungs={open > 0} />
        )}
      </div>
      {open === 0 && (
        <button className="btn btn-secondary btn-sm" onClick={onHide} title="Removes it from this list only; any exits on Nado keep running">
          Hide
        </button>
      )}
    </li>
  );
}
