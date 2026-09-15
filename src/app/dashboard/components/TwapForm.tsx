'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  cancelOrders,
  fetchTwapExecutions,
  fromX18,
  planTwap,
  placeTwapOrder,
  TWAP_MAX_DURATION_SECONDS,
  type NadoNetwork,
  type ProductSymbol,
  type SignTypedDataAsync,
  type TwapExecution,
  type TwapInput,
} from '@/lib/nado';

interface Props {
  network: NadoNetwork;
  sign: SignTypedDataAsync;
  sender: `0x${string}`;
  product: ProductSymbol;
  bid: number | null;
  ask: number | null;
}

type Mode = 'twap' | 'dca';

interface SavedTwap {
  digest: string;
  chainId: number;
  sender: string;
  productId: number;
  symbol: string;
  mode: Mode;
  side: 'buy' | 'sell';
  size: number;
  executions: number;
  intervalSeconds: number;
  createdAt: number;
}

const STORAGE_KEY = 'nadobot:twaps';
const usd = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const trim = (n: number) => String(Number(n.toFixed(1)));
const duration = (s: number) => (s < 60 ? `${s} s` : s < 3600 ? `${trim(s / 60)} min` : `${trim(s / 3600)} h`);

const DCA_INTERVALS = [
  { label: 'Every 15 min', seconds: 900 },
  { label: 'Every 30 min', seconds: 1800 },
  { label: 'Every hour', seconds: 3600 },
  { label: 'Every 2 hours', seconds: 7200 },
  { label: 'Every 4 hours', seconds: 14400 },
];

function loadSaved(): SavedTwap[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
  } catch {
    return [];
  }
}

function save(list: SavedTwap[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, 30)));
  } catch {}
}

/**
 * TWAP: split a large order into timed slices to reduce price impact. DCA: the same Nado primitive used to buy (or
 * sell) steadily over hours. One signature; Nado executes every slice on its own servers.
 */
export function TwapForm({ network, sign, sender, product, bid, ask }: Props) {
  const [mode, setMode] = useState<Mode>('twap');
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [unit, setUnit] = useState<'usd' | 'base'>('usd');
  const [amount, setAmount] = useState('1000');
  const [executions, setExecutions] = useState('5');
  const [twapMinutes, setTwapMinutes] = useState('30');
  const [dcaInterval, setDcaInterval] = useState(14400);
  const [dcaHours, setDcaHours] = useState('24');
  const [slippage, setSlippage] = useState('0.5');
  const [limitPrice, setLimitPrice] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [saved, setSaved] = useState<SavedTwap[]>([]);

  useEffect(() => setSaved(loadSaved()), []);

  const base = product.symbol.replace('-PERP', '');
  const market = side === 'buy' ? ask : bid;
  // Default guard rail: 3% past today's price. The trader can tighten it.
  const defaultLimit = market ? market * (side === 'buy' ? 1.03 : 0.97) : 0;

  const schedule = useMemo(() => {
    if (mode === 'dca') {
      const hours = Math.min(Number(dcaHours) || 0, 24);
      return { executions: Math.max(Math.floor((hours * 3600) / dcaInterval) + 1, 1), intervalSeconds: dcaInterval };
    }
    const n = Math.max(Math.floor(Number(executions) || 0), 1);
    const totalSeconds = (Number(twapMinutes) || 0) * 60;
    return { executions: n, intervalSeconds: n > 1 ? Math.max(Math.round(totalSeconds / (n - 1)), 1) : 1 };
  }, [mode, dcaHours, dcaInterval, executions, twapMinutes]);

  const input: TwapInput | null = useMemo(() => {
    const value = Number(amount);
    if (!value || !market) return null;
    const totalSize = unit === 'usd' ? value / market : value;
    return {
      productId: product.product_id,
      sender,
      side,
      totalSize,
      executions: schedule.executions,
      intervalSeconds: schedule.intervalSeconds,
      slippagePercent: Number(slippage),
      limitPrice: Number(limitPrice) || defaultLimit,
      marketPrice: market,
      priceIncrementX18: BigInt(product.price_increment_x18),
      sizeIncrementX18: BigInt(product.size_increment),
      minOrderValueX18: BigInt(product.min_size),
    };
  }, [amount, market, unit, product, sender, side, schedule, slippage, limitPrice, defaultLimit]);

  const plan = input ? planTwap(input, Math.floor(Date.now() / 1000)) : null;
  const sliceSize = plan ? Math.abs(fromX18(plan.sliceAmounts[0] ?? 0n)) : 0;

  async function submit() {
    if (!input || !plan || plan.errors.length) return;
    setBusy(true);
    setMessage(null);
    try {
      const { digest } = await placeTwapOrder(network, sign, input);
      const entry: SavedTwap = {
        digest,
        chainId: network.chainId,
        sender,
        productId: product.product_id,
        symbol: product.symbol,
        mode,
        side,
        size: Math.abs(fromX18(plan.amount)),
        executions: schedule.executions,
        intervalSeconds: schedule.intervalSeconds,
        createdAt: Date.now(),
      };
      const next = [entry, ...loadSaved().filter((s) => s.digest !== digest)];
      save(next);
      setSaved(next);
      setMessage({ ok: true, text: `${mode === 'dca' ? 'DCA' : 'TWAP'} started. Nado runs every execution, so you can close this page.` });
    } catch (e: any) {
      setMessage({ ok: false, text: `Could not start: ${e.shortMessage ?? e.message}` });
    } finally {
      setBusy(false);
    }
  }

  const mine = saved.filter((s) => s.chainId === network.chainId && s.sender === sender);

  return (
    <div className="glass panel">
      <div className="panel-header">
        <div>
          <h3>TWAP &amp; DCA</h3>
          <p className="muted" style={{ marginTop: '0.4rem', maxWidth: 680 }}>
            {mode === 'twap'
              ? 'Split a large order into smaller buys or sells over time to reduce price impact.'
              : 'Buy (or sell) a fixed amount on a schedule to average your price.'}{' '}
            One signature: Nado executes every slice while you&apos;re offline. Nado limits a schedule to 25 hours, so DCA runs up to a
            day at a time.
          </p>
        </div>
        <div className="segmented" role="radiogroup" aria-label="Mode">
          {(['twap', 'dca'] as Mode[]).map((m) => (
            <button key={m} role="radio" aria-checked={mode === m} className={`segment ${mode === m ? 'active' : ''}`} onClick={() => setMode(m)}>
              {m.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      <div className="form-row">
        <label className="field">
          <span>Side</span>
          <select value={side} onChange={(e) => setSide(e.target.value as 'buy' | 'sell')}>
            <option value="buy">Buy</option>
            <option value="sell">Sell</option>
          </select>
        </label>
        <label className="field">
          <span>Total amount</span>
          <input type="number" min="0" step="any" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <label className="field">
          <span>In</span>
          <select value={unit} onChange={(e) => setUnit(e.target.value as 'usd' | 'base')}>
            <option value="usd">USD</option>
            <option value="base">{base}</option>
          </select>
        </label>

        {mode === 'twap' ? (
          <>
            <label className="field">
              <span>Executions</span>
              <input type="number" min="2" max="500" step="1" value={executions} onChange={(e) => setExecutions(e.target.value)} />
            </label>
            <label className="field">
              <span>Over (minutes)</span>
              <input type="number" min="1" step="1" value={twapMinutes} onChange={(e) => setTwapMinutes(e.target.value)} />
            </label>
          </>
        ) : (
          <>
            <label className="field">
              <span>Frequency</span>
              <select value={dcaInterval} onChange={(e) => setDcaInterval(Number(e.target.value))}>
                {DCA_INTERVALS.map((i) => (
                  <option key={i.seconds} value={i.seconds}>
                    {i.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>For (hours, max 24)</span>
              <input type="number" min="1" max="24" step="1" value={dcaHours} onChange={(e) => setDcaHours(e.target.value)} />
            </label>
          </>
        )}

        <label className="field">
          <span>Max slippage %</span>
          <input type="number" min="0.1" max="10" step="0.1" value={slippage} onChange={(e) => setSlippage(e.target.value)} />
        </label>
        <label className="field">
          <span>{side === 'buy' ? 'Never buy above' : 'Never sell below'}</span>
          <input
            type="number"
            min="0"
            step="any"
            placeholder={defaultLimit ? defaultLimit.toFixed(0) : ''}
            value={limitPrice}
            onChange={(e) => setLimitPrice(e.target.value)}
          />
        </label>
      </div>

      {plan && (
        <div className="kv">
          <div>
            <span>Each execution</span>
            {side === 'buy' ? 'Buy' : 'Sell'} {sliceSize} {base} (~{usd(sliceSize * (market ?? 0))})
          </div>
          <div>
            <span>Schedule</span>
            {schedule.executions} executions · every {duration(schedule.intervalSeconds)}
          </div>
          <div>
            <span>Finishes</span>
            {plan.durationSeconds <= TWAP_MAX_DURATION_SECONDS ? `in ~${duration(Math.max(plan.durationSeconds, 60))}` : '—'}
          </div>
          <div>
            <span>Total</span>
            {Math.abs(fromX18(plan.amount))} {base} (~{usd(Math.abs(fromX18(plan.amount)) * (market ?? 0))})
          </div>
        </div>
      )}

      {plan?.errors.length ? <div className="notice error">{plan.errors[0]}</div> : null}

      <div className="form-row">
        <button className="btn btn-primary" onClick={submit} disabled={!plan || plan.errors.length > 0 || busy}>
          {busy ? 'Confirm the signature in your wallet…' : `Start ${mode === 'dca' ? 'DCA' : 'TWAP'}`}
        </button>
      </div>
      {message && <div className={`notice ${message.ok ? 'success' : 'error'}`}>{message.text}</div>}

      {mine.length > 0 && (
        <>
          <h4 style={{ marginTop: '1.75rem', marginBottom: '0.5rem' }}>Your schedules</h4>
          <ul className="activity">
            {mine.slice(0, 8).map((s) => (
              <TwapProgress key={s.digest} saved={s} network={network} sign={sign} sender={sender} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function TwapProgress({ saved, network, sign, sender }: { saved: SavedTwap; network: NadoNetwork; sign: SignTypedDataAsync; sender: `0x${string}` }) {
  const [executions, setExecutions] = useState<TwapExecution[] | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => fetchTwapExecutions(network, saved.digest).then(setExecutions).catch(() => {}), [network, saved.digest]);

  const counts = executions
    ? executions.reduce((c, e) => ({ ...c, [e.state]: (c[e.state] ?? 0) + 1 }), {} as Record<string, number>)
    : {};
  const done = executions !== null && executions.length > 0 && !counts.pending;

  useEffect(() => {
    load();
    if (done) return;
    const id = setInterval(load, 15_000);
    return () => clearInterval(id);
  }, [load, done]);

  async function cancel() {
    setCancelling(true);
    setError(null);
    try {
      await cancelOrders(network, sign, 'trigger', sender, [{ productId: saved.productId, digest: saved.digest }]);
      setTimeout(load, 3000);
    } catch (e: any) {
      setError(e.shortMessage ?? e.message);
    } finally {
      setCancelling(false);
    }
  }

  const executed = counts.executed ?? 0;
  const next = executions?.find((e) => e.state === 'pending');
  const lastFailure = executions?.filter((e) => e.state === 'failed').pop();

  return (
    <li className={lastFailure ? 'warn' : ''} style={{ alignItems: 'center' }}>
      <span className="activity-dot" aria-hidden />
      <div style={{ flex: 1 }}>
        <p>
          {saved.mode.toUpperCase()} · {saved.side === 'buy' ? 'Buy' : 'Sell'} {saved.size} {saved.symbol.replace('-PERP', '')} ·{' '}
          {executions === null ? 'loading…' : `${executed}/${saved.executions} executed`}
          {counts.failed ? ` · ${counts.failed} failed` : ''}
          {counts.cancelled ? ` · ${counts.cancelled} cancelled` : ''}
        </p>
        <div className="progress" aria-hidden>
          <div style={{ width: `${(executed / saved.executions) * 100}%` }} />
        </div>
        <span className="muted">
          {done
            ? 'Finished'
            : next
              ? `Next execution ${new Date(next.scheduledTime * 1000).toLocaleTimeString()}`
              : `Started ${new Date(saved.createdAt).toLocaleString()}`}
          {lastFailure?.detail ? ` · last failure: ${lastFailure.detail}` : ''}
        </span>
        {error && <span className="muted"> · cancel failed: {error}</span>}
      </div>
      {!done && executions !== null && (
        <button className="btn btn-secondary btn-sm" onClick={cancel} disabled={cancelling}>
          {cancelling ? 'Cancelling…' : 'Cancel'}
        </button>
      )}
    </li>
  );
}
