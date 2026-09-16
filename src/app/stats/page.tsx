'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { BOT_STATUS_URL } from '@/lib/nado';
import { summarizeStats, TOOL_LABELS, type StatsResponse } from '@/lib/stats';

const NETWORKS = [
  { chainId: 57073, label: 'Mainnet' },
  { chainId: 763373, label: 'Testnet' },
];
const RANGES = [7, 30, 90];
const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

/** Public, anonymous usage of Nadobot: how much order value flows through it and which tools traders use. */
export default function StatsPage() {
  const [chainId, setChainId] = useState(57073);
  const [days, setDays] = useState(30);
  const [data, setData] = useState<StatsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    fetch(`${BOT_STATUS_URL.replace(/\/$/, '')}/stats?days=${days}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Stats unavailable (${r.status})`))))
      .then((json) => !cancelled && setData(json))
      .catch((e) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [days]);

  const s = data ? summarizeStats(data, chainId) : null;
  const maxDay = s ? Math.max(...s.daily.map((d) => d.valueUsd), 1) : 1;

  return (
    <main className="container doc-page">
      <header className="doc-hero">
        <span className="pill">Usage</span>
        <h1>Nadobot in numbers</h1>
        <p className="subtitle">
          Orders placed on Nado through Nadobot, and which tools traders use. Anonymous counts only: no wallet addresses, IPs or
          identifiers are collected.
        </p>
        <div className="form-row" style={{ gap: '0.75rem' }}>
          <div className="segmented" role="radiogroup" aria-label="Network">
            {NETWORKS.map((n) => (
              <button key={n.chainId} role="radio" aria-checked={chainId === n.chainId} className={`segment ${chainId === n.chainId ? 'active' : ''}`} onClick={() => setChainId(n.chainId)}>
                {n.label}
              </button>
            ))}
          </div>
          <div className="segmented" role="radiogroup" aria-label="Period">
            {RANGES.map((r) => (
              <button key={r} role="radio" aria-checked={days === r} className={`segment ${days === r ? 'active' : ''}`} onClick={() => setDays(r)}>
                {r}d
              </button>
            ))}
          </div>
        </div>
      </header>

      {error && <div className="notice error">{error}</div>}
      {!s && !error && <p className="muted" style={{ marginTop: '2rem' }}>Loading…</p>}

      {s && (
        <>
          <div className="kv portfolio-stats" style={{ marginTop: '2rem' }}>
            <div>
              <span>Order value placed</span>
              <strong>{money(s.orderValueUsd)}</strong>
              <small className="muted">entries, schedules and closes · last {data!.days} days</small>
            </div>
            <div>
              <span>Orders and schedules</span>
              <strong>{s.orderActions.toLocaleString()}</strong>
              <small className="muted">market and limit orders, plans, ladders, TWAP, DCA, closes</small>
            </div>
            <div>
              <span>Wallet sessions</span>
              <strong>{s.walletSessions.toLocaleString()}</strong>
              <small className="muted">browser sessions that connected a wallet</small>
            </div>
            <div>
              <span>Shared trades</span>
              <strong>{s.shares.toLocaleString()}</strong>
              <small className="muted">PnL cards downloaded, copied or posted</small>
            </div>
          </div>

          <h3 style={{ marginTop: '2.5rem' }}>Order value per day</h3>
          <div className="stats-bars" role="img" aria-label={`Order value per day, last ${data!.days} days`}>
            {s.daily.map((d) => (
              <div key={d.day} className="stats-bar" title={`${d.day}: ${money(d.valueUsd)}`}>
                <span style={{ height: `${(d.valueUsd / maxDay) * 100}%` }} />
              </div>
            ))}
          </div>
          <div className="stats-axis muted">
            <span>{data!.from}</span>
            <span>{data!.to}</span>
          </div>

          <h3 style={{ marginTop: '2.5rem' }}>By tool</h3>
          <div className="table-scroll">
            <table className="data-table portfolio-table">
              <thead>
                <tr>
                  <th>Tool</th>
                  <th>Times used</th>
                  <th>Order value</th>
                </tr>
              </thead>
              <tbody>
                {s.tools.map((t) => (
                  <tr key={t.name}>
                    <td>{TOOL_LABELS[t.name]}</td>
                    <td>{t.count.toLocaleString()}</td>
                    <td>{t.valueUsd > 0 ? money(t.valueUsd) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted" style={{ marginTop: '1.5rem' }}>
            Value is the size of orders when they were placed, not what filled. See the <Link href="/privacy">Privacy notice</Link> for
            exactly what is counted.
          </p>
        </>
      )}
    </main>
  );
}
