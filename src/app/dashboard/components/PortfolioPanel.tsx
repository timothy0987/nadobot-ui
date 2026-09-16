'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BUILDER_ID,
  buildOpenPositions,
  closePosition,
  CLOSE_SLIPPAGE_PERCENT,
  fetchMarketPrice,
  fetchFillsSince,
  fetchLifetimeVolume,
  fetchOraclePrices,
  fetchPositions,
  fetchSubaccountInfo,
  formatPrice,
  fromX18,
  liquidationPrice,
  parseAccountRisk,
  planClose,
  positionNetPnl,
  summarizeFills,
  type Match,
  type NadoNetwork,
  type OpenPositionView,
  type PnlBucket,
  type PositionRecord,
  type ProductSymbol,
  type SignTypedDataAsync,
} from '@/lib/nado';
import { pnlCardData } from '@/lib/pnlCard';
import { ShareCard } from './ShareCard';

interface Props {
  network: NadoNetwork;
  sign: SignTypedDataAsync;
  sender: `0x${string}`;
  symbols: Record<string, ProductSymbol>;
  /** Called after a position is closed, so the rest of the dashboard can refresh. */
  onClosed: () => void;
}

/** A close the trader has asked for but not yet signed. */
interface PendingClose {
  productId: number;
  fraction: number;
  amount: bigint;
  symbol: string;
}

type Range = '24h' | '7d' | '30d';
const RANGES: Record<Range, { seconds: number; bucket: number; label: string }> = {
  '24h': { seconds: 86400, bucket: 3600, label: 'last 24 hours' },
  '7d': { seconds: 7 * 86400, bucket: 86400, label: 'last 7 days' },
  '30d': { seconds: 30 * 86400, bucket: 86400, label: 'last 30 days' },
};

const usd = (n: number, digits = 2) => `$${n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
const signedUsd = (n: number) => `${n < 0 ? '−' : n > 0 ? '+' : ''}${usd(Math.abs(n))}`;
const compactUsd = (n: number) => `$${Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(n)}`;
const pnlColor = (n: number) => (n > 0.005 ? 'var(--success)' : n < -0.005 ? 'var(--danger)' : undefined);

function duration(seconds: number) {
  if (seconds < 3600) return `${Math.max(Math.round(seconds / 60), 1)} min`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} h`;
  return `${Math.round(seconds / 86400)} d`;
}

/**
 * The connected wallet's trading on Nado: open positions at the mark, closed position history, and PnL and volume
 * over time. Everything here is public indexer and gateway data, so it needs no wallet signature.
 */
export function PortfolioPanel({ network, sign, sender, symbols, onClosed }: Props) {
  const [range, setRange] = useState<Range>('7d');
  const [tab, setTab] = useState<'open' | 'history'>('open');
  const [open, setOpen] = useState<(OpenPositionView & { liquidationPrice: number | null })[] | null>(null);
  const [fills, setFills] = useState<{ fills: Match[]; truncated: boolean; since: number } | null>(null);
  const [lifetime, setLifetime] = useState<{ volume: number; trades: number } | null>(null);
  const [history, setHistory] = useState<{ positions: PositionRecord[]; nextIdx: string | null } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingClose | null>(null);
  const [quote, setQuote] = useState<{ bid: number; ask: number } | null>(null);
  const [closing, setClosing] = useState(false);
  const [closeResult, setCloseResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [sharing, setSharing] = useState<PositionRecord | null>(null);

  const bySymbolId = Object.fromEntries(Object.values(symbols).map((s) => [s.product_id, s]));
  const name = (productId: number) => bySymbolId[productId]?.symbol ?? `Market ${productId}`;
  const isPerp = (productId: number) => bySymbolId[productId]?.type === 'perp';
  const priceOf = (productId: number) => (n: number) => formatPrice(n, bySymbolId[productId]?.price_increment_x18);

  // Reset when the wallet or network changes, so one account's numbers never show under another.
  useEffect(() => {
    setOpen(null);
    setFills(null);
    setLifetime(null);
    setHistory(null);
    setError(null);
    setPending(null);
    setCloseResult(null);
    setSharing(null);
  }, [network, sender]);

  const loadOpen = useCallback(async () => {
    try {
      const [info, records, marks] = await Promise.all([
        fetchSubaccountInfo(network, sender),
        fetchPositions(network, sender, { open: true, limit: 100 }),
        fetchOraclePrices(network),
      ]);
      const account = parseAccountRisk(info);
      setOpen(buildOpenPositions(info, records.positions, marks).map((p) => ({ ...p, liquidationPrice: account ? liquidationPrice(account, p.productId) : null })));
    } catch (e: any) {
      setError(e.message);
    }
  }, [network, sender]);

  const loadActivity = useCallback(async () => {
    try {
      const since = Math.floor(Date.now() / 1000) - RANGES['30d'].seconds;
      const [recent, firstPage] = await Promise.all([fetchFillsSince(network, sender, since), fetchPositions(network, sender, { open: false, limit: 25 })]);
      setFills({ ...recent, since });
      // Keep pages loaded with "Load older", but put newly closed positions on top.
      setHistory((h) => {
        if (!h || h.positions.length <= firstPage.positions.length) return firstPage;
        const key = (p: PositionRecord) => `${p.productId}-${p.openId}-${p.isolated}`;
        const seen = new Set(firstPage.positions.map(key));
        return { positions: [...firstPage.positions, ...h.positions.filter((p) => !seen.has(key(p)))], nextIdx: h.nextIdx };
      });
      const traded = [...new Set([...recent.fills.map((f) => f.productId), ...firstPage.positions.map((p) => p.productId)])].filter((id) => id >= 0);
      if (traded.length) setLifetime(await fetchLifetimeVolume(network, sender, traded));
      else setLifetime({ volume: 0, trades: 0 });
      setError(null);
    } catch (e: any) {
      setError(e.message);
    }
  }, [network, sender]);

  useEffect(() => {
    loadOpen();
    const id = setInterval(loadOpen, 15_000);
    return () => clearInterval(id);
  }, [loadOpen]);

  useEffect(() => {
    loadActivity();
    const id = setInterval(loadActivity, 60_000);
    return () => clearInterval(id);
  }, [loadActivity]);

  // The quote is fetched when a close is requested, so the confirmation shows the price it would fill near.
  async function askToClose(p: OpenPositionView, fraction: number) {
    setCloseResult(null);
    setQuote(null);
    setPending({ productId: p.productId, fraction, amount: p.amountX18, symbol: name(p.productId) });
    try {
      setQuote(await fetchMarketPrice(network, p.productId));
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function confirmClose(plan: ReturnType<typeof planClose>) {
    if (!pending) return;
    setClosing(true);
    try {
      await closePosition(network, sign, { productId: pending.productId, sender, plan });
      setPending(null);
      setCloseResult({ ok: true, text: `Closing order sent for ${pending.symbol}. It fills immediately or is cancelled.` });
      setTimeout(() => {
        loadOpen();
        loadActivity();
        onClosed();
      }, 2500);
    } catch (e: any) {
      setCloseResult({ ok: false, text: `Could not close: ${e.shortMessage ?? e.message}` });
    } finally {
      setClosing(false);
    }
  }

  async function loadMore() {
    if (!history?.nextIdx) return;
    setLoadingMore(true);
    try {
      const page = await fetchPositions(network, sender, { open: false, limit: 25, idx: history.nextIdx });
      setHistory({ positions: [...history.positions, ...page.positions], nextIdx: page.nextIdx });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoadingMore(false);
    }
  }

  const now = Math.floor(Date.now() / 1000);
  const { seconds, bucket, label } = RANGES[range];
  const summary = fills ? summarizeFills(fills.fills, now - seconds, now, BUILDER_ID, bucket) : null;
  const unrealized = open?.reduce((a, p) => a + p.unrealizedPnl, 0) ?? null;
  const closed = history?.positions.filter((p) => isPerp(p.productId) || !Object.keys(symbols).length) ?? null;
  // A range is only complete if the fill history reached back to its start.
  const rangeTruncated = Boolean(fills?.truncated && fills.fills.length && fills.fills[fills.fills.length - 1].timestamp > now - seconds);

  return (
    <div className="glass panel">
      <div className="panel-header">
        <div>
          <h3>Portfolio</h3>
          <p className="muted" style={{ marginTop: '0.4rem', maxWidth: 640 }}>
            Your positions, PnL and volume on Nado {network.chainId === 57073 ? 'mainnet' : 'testnet'}, across every market and every app you trade from.
          </p>
        </div>
        <div className="segmented" role="radiogroup" aria-label="Time range">
          {(Object.keys(RANGES) as Range[]).map((r) => (
            <button key={r} role="radio" aria-checked={range === r} className={`segment ${range === r ? 'active' : ''}`} onClick={() => setRange(r)}>
              {r}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="notice error">Could not load portfolio data: {error}</div>}

      <div className="kv portfolio-stats">
        <div>
          <span>Unrealized PnL</span>
          <strong style={{ color: pnlColor(unrealized ?? 0) }}>{unrealized === null ? '…' : signedUsd(unrealized)}</strong>
          <small className="muted">{open === null ? '' : `${open.length} open position${open.length === 1 ? '' : 's'}`}</small>
        </div>
        <div>
          <span>Realized PnL · {range}</span>
          <strong style={{ color: pnlColor(summary?.netPnl ?? 0) }}>{summary ? signedUsd(summary.netPnl) : '…'}</strong>
          <small className="muted">{summary ? `after ${usd(summary.fees)} fees, before funding` : ''}</small>
        </div>
        <div>
          <span>Volume · {range}</span>
          <strong>{summary ? usd(summary.volume) : '…'}</strong>
          <small className="muted">{summary ? `${summary.fills} fill${summary.fills === 1 ? '' : 's'} · ${summary.volume ? Math.round((summary.makerVolume / summary.volume) * 100) : 0}% maker` : ''}</small>
        </div>
        <div>
          <span>Lifetime volume</span>
          <strong>{lifetime ? usd(lifetime.volume) : '…'}</strong>
          <small className="muted">{lifetime ? `${lifetime.trades.toLocaleString()} fills` : ''}</small>
        </div>
        {BUILDER_ID > 0 && (
          <div>
            <span>Via Nadobot · {range}</span>
            <strong>{summary ? usd(summary.builderVolume) : '…'}</strong>
            <small className="muted">{summary && summary.volume ? `${Math.round((summary.builderVolume / summary.volume) * 100)}% of your volume` : ''}</small>
          </div>
        )}
      </div>

      {summary && <ActivityChart buckets={summary.buckets} bucketSeconds={bucket} label={label} />}
      {rangeTruncated && <p className="muted">Showing your most recent 2,000 fills; older fills in this range aren&apos;t included.</p>}

      <div className="segmented" role="tablist" aria-label="Positions" style={{ marginTop: '1.5rem' }}>
        <button role="tab" aria-selected={tab === 'open'} className={`segment ${tab === 'open' ? 'active' : ''}`} onClick={() => setTab('open')}>
          Open positions{open ? ` (${open.length})` : ''}
        </button>
        <button role="tab" aria-selected={tab === 'history'} className={`segment ${tab === 'history' ? 'active' : ''}`} onClick={() => setTab('history')}>
          History
        </button>
      </div>

      {closeResult && <div className={`notice ${closeResult.ok ? 'success' : 'error'}`}>{closeResult.text}</div>}

      {pending &&
        (() => {
          const product = bySymbolId[pending.productId];
          const plan =
            quote && product
              ? planClose({
                  positionAmount: pending.amount,
                  fraction: pending.fraction,
                  bid: quote.bid,
                  ask: quote.ask,
                  priceIncrementX18: BigInt(product.price_increment_x18),
                  sizeIncrementX18: BigInt(product.size_increment),
                  minOrderValueX18: BigInt(product.min_size),
                })
              : null;
          const closingLong = pending.amount > 0n;
          const share = plan ? Math.round(plan.fractionClosed * 100) : 0;
          return (
            <div className="notice close-confirm">
              {!plan ? (
                <span className="muted">Checking the {pending.symbol} price…</span>
              ) : (
                <>
                  <p>
                    <strong>
                      {closingLong ? 'Sell' : 'Buy'} {Math.abs(fromX18(plan.amount))} {pending.symbol.replace('-PERP', '')}
                    </strong>{' '}
                    to close {share}% of your position, about {usd(plan.notional)} at the current price.
                  </p>
                  <p className="muted">
                    Fills straight away at no worse than {priceOf(pending.productId)(fromX18(plan.limitPriceX18))} ({CLOSE_SLIPPAGE_PERCENT}% past
                    the {closingLong ? 'bid' : 'ask'}), or is cancelled. It can only reduce your position, never open one the other way. One
                    signature.
                  </p>
                  {plan.errors.map((e) => (
                    <div key={e} className="notice error">
                      {e}
                    </div>
                  ))}
                  <div className="form-row">
                    <button className="btn btn-primary btn-sm" disabled={closing || plan.errors.length > 0} onClick={() => confirmClose(plan)}>
                      {closing ? 'Confirm in your wallet…' : `Close ${share}% now`}
                    </button>
                    <button className="btn btn-secondary btn-sm" disabled={closing} onClick={() => setPending(null)}>
                      Cancel
                    </button>
                  </div>
                </>
              )}
            </div>
          );
        })()}

      {tab === 'open' ? (
        open === null ? (
          <p className="muted" style={{ marginTop: '1rem' }}>Loading positions…</p>
        ) : open.length === 0 ? (
          <p className="muted" style={{ marginTop: '1rem' }}>No open positions.</p>
        ) : (
          <div className="table-scroll" style={{ marginTop: '1rem' }}>
            <table className="data-table portfolio-table">
              <thead>
                <tr>
                  <th>Market</th>
                  <th>Side</th>
                  <th>Size</th>
                  <th>Entry</th>
                  <th>Mark</th>
                  <th>Value</th>
                  <th>Unrealized PnL</th>
                  <th>Est. liq. price</th>
                  <th>Funding</th>
                  <th>Close</th>
                </tr>
              </thead>
              <tbody>
                {open.map((p) => (
                  <tr key={`${p.productId}-${p.long}`}>
                    <td>{name(p.productId)}</td>
                    <td style={{ color: p.long ? 'var(--success)' : 'var(--danger)' }}>{p.long ? 'Long' : 'Short'}</td>
                    <td>{p.size}</td>
                    <td>{priceOf(p.productId)(p.entryPrice)}</td>
                    <td>{priceOf(p.productId)(p.markPrice)}</td>
                    <td>{usd(p.value)}</td>
                    <td style={{ color: pnlColor(p.unrealizedPnl) }}>
                      {signedUsd(p.unrealizedPnl)} <span className="muted">({p.unrealizedPercent >= 0 ? '+' : ''}{p.unrealizedPercent.toFixed(2)}%)</span>
                    </td>
                    <td>{p.liquidationPrice === null ? 'None' : priceOf(p.productId)(p.liquidationPrice)}</td>
                    <td style={{ color: pnlColor(p.funding) }}>{signedUsd(p.funding)}</td>
                    <td>
                      <span className="close-buttons">
                        {[0.25, 0.5, 1].map((fraction) => (
                          <button
                            key={fraction}
                            className="btn btn-secondary btn-sm"
                            onClick={() => askToClose(p, fraction)}
                            disabled={closing}
                            title={`Close ${fraction === 1 ? 'the whole position' : `${fraction * 100}% of the position`} at market`}
                          >
                            {fraction === 1 ? 'All' : `${fraction * 100}%`}
                          </button>
                        ))}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : closed === null ? (

        <p className="muted" style={{ marginTop: '1rem' }}>Loading history…</p>
      ) : closed.length === 0 ? (
        <p className="muted" style={{ marginTop: '1rem' }}>No closed positions yet.</p>
      ) : (
        <>
          {sharing && (
            <ShareCard
              key={`${sharing.productId}-${sharing.openId}`}
              data={pnlCardData(sharing, name(sharing.productId), bySymbolId[sharing.productId]?.price_increment_x18)}
              onClose={() => setSharing(null)}
            />
          )}
          <div className="table-scroll" style={{ marginTop: '1rem' }}>
            <table className="data-table portfolio-table">
              <thead>
                <tr>
                  <th>Closed</th>
                  <th>Market</th>
                  <th>Side</th>
                  <th>Max size</th>
                  <th>Entry → exit</th>
                  <th>Held</th>
                  <th>Fees + funding</th>
                  <th>Net PnL</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {closed.map((p) => {
                  const net = positionNetPnl(p);
                  return (
                    <tr key={`${p.productId}-${p.openId}-${p.isolated}`}>
                      <td>{new Date(p.updatedAt * 1000).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                      <td>
                        {name(p.productId)}
                        {p.liquidatedSize > 0 && <div className="muted">liquidated</div>}
                      </td>
                      <td style={{ color: p.long ? 'var(--success)' : 'var(--danger)' }}>{p.long ? 'Long' : 'Short'}</td>
                      <td>{p.maxSize}</td>
                      <td>
                        {priceOf(p.productId)(p.entryPrice)} → {priceOf(p.productId)(p.exitPrice)}
                      </td>
                      <td>{duration(p.updatedAt - p.openedAt)}</td>
                      <td>{signedUsd(p.funding - p.fees)}</td>
                      <td style={{ color: pnlColor(net) }}>{signedUsd(net)}</td>
                      <td>
                        <button className="btn btn-secondary btn-sm" onClick={() => setSharing(p)}>
                          Share
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {history?.nextIdx && (
            <button className="btn btn-secondary btn-sm" style={{ marginTop: '0.75rem' }} onClick={loadMore} disabled={loadingMore}>
              {loadingMore ? 'Loading…' : 'Load older positions'}
            </button>
          )}
        </>
      )}
    </div>
  );
}

/** Volume per bucket as bars, with cumulative net realized PnL drawn over them as a line. */
function ActivityChart({ buckets, bucketSeconds, label }: { buckets: PnlBucket[]; bucketSeconds: number; label: string }) {
  // Drawn at the container's real width so labels stay readable on phones instead of shrinking with a fixed viewBox.
  const figureRef = useRef<HTMLElement>(null);
  const [W, setW] = useState(720);
  useEffect(() => {
    const el = figureRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setW(Math.max(Math.round(entry.contentRect.width), 240)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const H = 200;
  const pad = { top: 16, right: W < 480 ? 56 : 64, bottom: 26, left: W < 480 ? 44 : 56 };
  const innerW = W - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;
  const hasActivity = buckets.some((b) => b.volume > 0);

  let running = 0;
  const cumulative = buckets.map((b) => (running += b.pnl));
  const maxVolume = Math.max(...buckets.map((b) => b.volume), 1);
  const pnlMin = Math.min(0, ...cumulative);
  const pnlMax = Math.max(0, ...cumulative);
  const pnlSpan = pnlMax - pnlMin || 1;
  const slot = innerW / Math.max(buckets.length, 1);
  const x = (i: number) => pad.left + slot * i + slot / 2;
  const yPnl = (v: number) => pad.top + innerH - ((v - pnlMin) / pnlSpan) * innerH;
  const bucketLabel = (start: number) =>
    new Date(start * 1000).toLocaleString(undefined, bucketSeconds < 86400 ? { hour: '2-digit', minute: '2-digit' } : { month: 'short', day: 'numeric' });
  const ticks = [0, Math.floor((buckets.length - 1) / 2), buckets.length - 1].filter((v, i, a) => a.indexOf(v) === i);
  const finalPnl = cumulative[cumulative.length - 1] ?? 0;

  return (
    <figure ref={figureRef} className="activity-chart" style={{ margin: '1rem 0 0' }}>
      <figcaption className="chart-legend">
        <span>
          <i className="legend-bar" aria-hidden /> Volume per {bucketSeconds < 86400 ? 'hour' : 'day'}
        </span>
        <span>
          <i className="legend-line" aria-hidden style={{ background: finalPnl < 0 ? 'var(--danger)' : 'var(--success)' }} /> Cumulative realized PnL (after fees)
        </span>
      </figcaption>
      {hasActivity ? (
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Volume and cumulative realized PnL, ${label}. Net ${signedUsd(finalPnl)}.`}>
          <text x={pad.left - 8} y={pad.top + 4} textAnchor="end" className="chart-axis">
            {compactUsd(maxVolume)}
          </text>
          <text x={pad.left - 8} y={pad.top + innerH} textAnchor="end" className="chart-axis">
            $0
          </text>
          <line x1={pad.left} x2={W - pad.right} y1={yPnl(0)} y2={yPnl(0)} className="chart-zero" />
          <text x={W - pad.right + 8} y={yPnl(pnlMax) + 4} className="chart-axis">
            {signedUsd(pnlMax)}
          </text>
          {pnlMin < 0 && (
            <text x={W - pad.right + 8} y={yPnl(pnlMin) + 4} className="chart-axis">
              {signedUsd(pnlMin)}
            </text>
          )}
          {buckets.map((b, i) => {
            const h = (b.volume / maxVolume) * innerH;
            return (
              <rect key={b.start} x={x(i) - Math.max(slot * 0.35, 1)} width={Math.max(slot * 0.7, 2)} y={pad.top + innerH - h} height={Math.max(h, b.volume ? 1 : 0)} className="chart-bar">
                <title>
                  {bucketLabel(b.start)}: {usd(b.volume)} volume, {signedUsd(b.pnl)} realized
                </title>
              </rect>
            );
          })}
          <polyline
            fill="none"
            className="chart-line"
            style={{ stroke: finalPnl < 0 ? 'var(--danger)' : 'var(--success)' }}
            points={cumulative.map((v, i) => `${x(i)},${yPnl(v)}`).join(' ')}
          />
          {ticks.map((i) => (
            <text key={i} x={x(i)} y={H - 6} textAnchor="middle" className="chart-axis">
              {bucketLabel(buckets[i].start)}
            </text>
          ))}
        </svg>
      ) : (
        <p className="muted" style={{ padding: '2rem 0', textAlign: 'center' }}>
          No trades in the {label}.
        </p>
      )}
    </figure>
  );
}
