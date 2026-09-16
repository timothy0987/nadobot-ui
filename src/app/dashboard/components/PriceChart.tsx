'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { formatPrice, type NadoNetwork, type ProductSymbol } from '@/lib/nado';
import { dayStats, fetchCandles, fetchFundingRate, fillCandleGaps, priceTicks, TIMEFRAMES, type Candle, type MarketStats, type TimeframeId } from '@/lib/chart';

interface Props {
  network: NadoNetwork;
  product: ProductSymbol;
  bid: number | null;
  ask: number | null;
  /** The trader's position on this market, drawn on the chart when there is one. */
  entryPrice?: number | null;
  liquidationPrice?: number | null;
  positionSide?: 'long' | 'short' | null;
}

const compact = (n: number) => `$${Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n)}`;

/**
 * Candlestick chart for the selected market, with 24h stats and funding, so traders can decide and act without leaving
 * Nadobot. The trader's own entry and estimated liquidation price are drawn on it.
 */
export function PriceChart({ network, product, bid, ask, entryPrice, liquidationPrice, positionSide }: Props) {
  const [timeframe, setTimeframe] = useState<TimeframeId>('1h');
  const [candles, setCandles] = useState<Candle[] | null>(null);
  const [stats, setStats] = useState<MarketStats | null>(null);
  const [funding, setFunding] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const tf = TIMEFRAMES.find((t) => t.id === timeframe)!;
  const tick = product.price_increment_x18;
  const price = (n: number) => formatPrice(n, tick);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(Math.round(entry.contentRect.width), 280)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Candles for the chosen timeframe, refreshed every 30 seconds.
  useEffect(() => {
    let cancelled = false;
    setCandles(null);
    setError(null);
    const load = () =>
      fetchCandles(network, product.product_id, tf.granularity, tf.candles)
        .then((c) => !cancelled && setCandles(fillCandleGaps(c, tf.granularity, tf.candles, Math.floor(Date.now() / 1000))))
        .catch((e) => !cancelled && setError(e.message));
    load();
    const id = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [network, product.product_id, tf.granularity, tf.candles]);

  // 24h stats and funding, every minute.
  useEffect(() => {
    let cancelled = false;
    setStats(null);
    setFunding(null);
    const load = () => {
      fetchCandles(network, product.product_id, 3600, 26)
        .then((c) => !cancelled && setStats(dayStats(c, Math.floor(Date.now() / 1000))))
        .catch(() => {});
      fetchFundingRate(network, product.product_id)
        .then((f) => !cancelled && setFunding(f))
        .catch(() => {});
    };
    load();
    const id = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [network, product.product_id]);

  const mid = bid && ask ? (bid + ask) / 2 : (candles?.[candles.length - 1]?.close ?? null);
  const hovered = hover !== null && candles ? candles[hover] : null;

  const H = width < 520 ? 260 : 340;
  const pad = { top: 12, right: width < 520 ? 62 : 76, bottom: 24, left: 8 };
  const volumeHeight = H * 0.16;
  const plotH = H - pad.top - pad.bottom - volumeHeight - 6;
  const plotW = width - pad.left - pad.right;

  const geometry = useMemo(() => {
    if (!candles?.length) return null;
    let low = Math.min(...candles.map((c) => c.low));
    let high = Math.max(...candles.map((c) => c.high));
    // Keep the trader's entry in view; a far-away liquidation price is shown at the edge instead of squashing the chart.
    if (entryPrice && entryPrice > 0) {
      low = Math.min(low, entryPrice);
      high = Math.max(high, entryPrice);
    }
    const margin = (high - low) * 0.06 || high * 0.01;
    low -= margin;
    high += margin;
    const slot = plotW / candles.length;
    return {
      low,
      high,
      slot,
      y: (p: number) => pad.top + ((high - p) / (high - low)) * plotH,
      x: (i: number) => pad.left + slot * i + slot / 2,
      maxVolume: Math.max(...candles.map((c) => c.volume), 1e-12),
    };
  }, [candles, entryPrice, plotW, plotH, pad.top, pad.left]);

  const timeLabel = (t: number) =>
    new Date(t * 1000).toLocaleString(undefined, tf.granularity >= 86400 ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  const shown = hovered ?? null;
  const change = stats?.changePercent ?? null;

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    if (!geometry || !candles) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * width;
    const i = Math.floor((x - pad.left) / geometry.slot);
    setHover(i >= 0 && i < candles.length ? i : null);
  }

  const levelLine = (value: number | null | undefined, label: string, className: string) => {
    if (!geometry || !value || value <= 0) return null;
    const inside = value >= geometry.low && value <= geometry.high;
    const y = inside ? geometry.y(value) : value > geometry.high ? pad.top + 8 : pad.top + plotH - 4;
    return (
      <g className={`chart-level ${className}`}>
        {inside && <line x1={pad.left} x2={pad.left + plotW} y1={y} y2={y} />}
        <rect x={pad.left + plotW + 2} y={y - 9} width={pad.right - 4} height={18} rx={3} />
        <text x={pad.left + plotW + 6} y={y + 4}>
          {inside ? label : `${label} ${value > geometry.high ? '↑' : '↓'}`}
        </text>
        <title>{`${label}: ${price(value)}`}</title>
      </g>
    );
  };

  return (
    <div className="glass panel price-chart">
      <div className="panel-header" style={{ marginBottom: '0.5rem' }}>
        <div>
          <div className="chart-title">
            <h3>{product.symbol}</h3>
            <span className="chart-price">{mid ? price(mid) : '…'}</span>
            {change !== null && (
              <span className="chart-change" style={{ color: change >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                {change >= 0 ? '+' : ''}
                {change.toFixed(2)}% 24h
              </span>
            )}
          </div>
          <div className="chart-meta muted">
            {shown ? (
              <>
                {timeLabel(shown.time)} · O {price(shown.open)} · H {price(shown.high)} · L {price(shown.low)} · C {price(shown.close)}
              </>
            ) : (
              <>
                {stats && (
                  <>
                    24h high {price(stats.high)} · low {price(stats.low)} · volume {compact(stats.volumeUsd)}
                  </>
                )}
                {funding !== null && (
                  <span title="Nado's funding rate over 24 hours. Positive: longs pay shorts. Negative: shorts pay longs.">
                    {stats ? ' · ' : ''}funding {funding >= 0 ? '+' : ''}
                    {(funding * 100).toFixed(4)}%/day ({funding >= 0 ? 'longs pay' : 'shorts pay'})
                  </span>
                )}
              </>
            )}
          </div>
        </div>
        <div className="segmented" role="radiogroup" aria-label="Timeframe">
          {TIMEFRAMES.map((t) => (
            <button key={t.id} role="radio" aria-checked={timeframe === t.id} className={`segment ${timeframe === t.id ? 'active' : ''}`} onClick={() => setTimeframe(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div ref={wrapRef} className="chart-wrap">
        {error && <div className="notice error">Couldn&apos;t load the chart: {error}</div>}
        {!error && !candles && <div className="chart-placeholder muted" style={{ height: H }}>Loading chart…</div>}
        {!error && candles?.length === 0 && (
          <div className="chart-placeholder muted" style={{ height: H }}>
            No trades on {product.symbol} yet.
          </div>
        )}
        {geometry && candles && candles.length > 0 && (
          <svg
            viewBox={`0 0 ${width} ${H}`}
            width="100%"
            role="img"
            aria-label={`${product.symbol} ${tf.label} price chart`}
            onMouseMove={onMove}
            onMouseLeave={() => setHover(null)}
          >
            {priceTicks(geometry.low, geometry.high).map((p) => (
              <g key={p} className="chart-grid">
                <line x1={pad.left} x2={pad.left + plotW} y1={geometry.y(p)} y2={geometry.y(p)} />
                <text x={pad.left + plotW + 6} y={geometry.y(p) + 4}>
                  {price(p)}
                </text>
              </g>
            ))}

            {candles.map((c, i) => {
              const up = c.close >= c.open;
              const x = geometry.x(i);
              const bodyW = Math.max(geometry.slot * 0.62, 1);
              const top = geometry.y(Math.max(c.open, c.close));
              const bottom = geometry.y(Math.min(c.open, c.close));
              const volH = (c.volume / geometry.maxVolume) * volumeHeight;
              return (
                <g key={c.time} className={up ? 'candle up' : 'candle down'}>
                  <line x1={x} x2={x} y1={geometry.y(c.high)} y2={geometry.y(c.low)} />
                  <rect x={x - bodyW / 2} y={top} width={bodyW} height={Math.max(bottom - top, 1)} />
                  <rect className="volume" x={x - bodyW / 2} y={H - pad.bottom - volH} width={bodyW} height={volH} />
                </g>
              );
            })}

            {hover !== null && <line className="chart-crosshair" x1={geometry.x(hover)} x2={geometry.x(hover)} y1={pad.top} y2={H - pad.bottom} />}

            {levelLine(entryPrice, positionSide === 'short' ? 'Short entry' : 'Entry', 'entry')}
            {levelLine(liquidationPrice, 'Liq.', 'liquidation')}
            {levelLine(mid, price(mid ?? 0), 'last')}

            {[0, Math.floor(candles.length / 2), candles.length - 1].map((i) => (
              <text key={i} className="chart-time" x={geometry.x(i)} y={H - 6} textAnchor={i === 0 ? 'start' : i === candles.length - 1 ? 'end' : 'middle'}>
                {timeLabel(candles[i].time)}
              </text>
            ))}
          </svg>
        )}
      </div>
    </div>
  );
}
