'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BUILDER_ID,
  buildOpenPositions,
  fetchFillsSince,
  fetchLifetimeVolume,
  fetchOraclePrices,
  fetchPositions,
  fetchSubaccountInfo,
  positionNetPnl,
  summarizeFills,
  type Match,
  type NadoNetwork,
  type OpenPositionView,
  type PnlBucket,
  type PositionRecord,
  type ProductSymbol,
} from '@/lib/nado';

interface Props {
  network: NadoNetwork;
  sender: `0x${string}`;
  symbols: Record<string, ProductSymbol>;
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
const price = (n: number) => usd(n, n >= 100 ? 2 : 4);

function duration(seconds: number) {
  if (seconds < 3600) return `${Math.max(Math.round(seconds / 60), 1)} min`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} h`;
  return `${Math.round(seconds / 86400)} d`;
}

/**
 * The connected wallet's trading on Nado: open positions at the mark, closed position history, and PnL and volume
 * over time. Everything here is public indexer and gateway data, so it needs no wallet signature.
 */
export function PortfolioPanel({ network, sender, symbols }: Props) {
  const [range, setRange] = useState<Range>('7d');
  const [tab, setTab] = useState<'open' | 'history'>('open');
  const [open, setOpen] = useState<OpenPositionView[] | null>(null);
  const [fills, setFills] = useState<{ fills: Match[]; truncated: boolean; since: number } | null>(null);
  const [lifetime, setLifetime] = useState<{ volume: number; trades: number } | null>(null);
  const [history, setHistory] = useState<{ positions: PositionRecord[]; nextIdx: string | null } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bySymbolId = Object.fromEntries(Object.values(symbols).map((s) => [s.product_id, s]));
  const name = (productId: number) => bySymbolId[productId]?.symbol ?? `Market ${productId}`;
  const isPerp = (productId: number) => bySymbolId[productId]?.type === 'perp';

  // Reset when the wallet or network changes, so one account's numbers never show under another.
  useEffect(() => {
    setOpen(null);
    setFills(null);
    setLifetime(null);
    setHistory(null);
    setError(null);
  }, [network, sender]);

  const loadOpen = useCallback(async () => {
    try {
      const [info, records, marks] = await Promise.all([
        fetchSubaccountInfo(network, sender),
        fetchPositions(network, sender, { open: true, limit: 100 }),
        fetchOraclePrices(network),
      ]);
      setOpen(buildOpenPositions(info, records.positions, marks));
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
                  <th>Funding</th>
                </tr>
              </thead>
              <tbody>
                {open.map((p) => (
                  <tr key={`${p.productId}-${p.long}`}>
                    <td>{name(p.productId)}</td>
                    <td style={{ color: p.long ? 'var(--success)' : 'var(--danger)' }}>{p.long ? 'Long' : 'Short'}</td>
                    <td>{p.size}</td>
                    <td>{price(p.entryPrice)}</td>
                    <td>{price(p.markPrice)}</td>
                    <td>{usd(p.value)}</td>
                    <td style={{ color: pnlColor(p.unrealizedPnl) }}>
                      {signedUsd(p.unrealizedPnl)} <span className="muted">({p.unrealizedPercent >= 0 ? '+' : ''}{p.unrealizedPercent.toFixed(2)}%)</span>
                    </td>
                    <td style={{ color: pnlColor(p.funding) }}>{signedUsd(p.funding)}</td>
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
                        {price(p.entryPrice)} → {price(p.exitPrice)}
                      </td>
                      <td>{duration(p.updatedAt - p.openedAt)}</td>
                      <td>{signedUsd(p.funding - p.fees)}</td>
                      <td style={{ color: pnlColor(net) }}>{signedUsd(net)}</td>
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
