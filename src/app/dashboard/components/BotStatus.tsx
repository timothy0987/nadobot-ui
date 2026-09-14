'use client';

import { useEffect, useState } from 'react';
import {
  BOT_STATUS_URL,
  INK_MAINNET,
  INK_SEPOLIA,
  fetchBotStatus,
  fetchMatches,
  fetchSymbols,
  type BotStatus as Status,
  type Match,
} from '@/lib/nado';

const usd = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const ago = (iso: string | null) => {
  if (!iso) return 'never';
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : `${Math.round(s / 3600)}h ago`;
};

/** Read-only view of the always-on bot: its strategy, position, protection and recent fills. No wallet needed. */
export function BotStatus() {
  const [status, setStatus] = useState<Status | null>(null);
  const [fills, setFills] = useState<Match[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!BOT_STATUS_URL) return;
    let cancelled = false;
    const load = async () => {
      try {
        const s = await fetchBotStatus();
        if (cancelled) return;
        setStatus(s);
        setError(null);
        const network = s.network === 'mainnet' ? INK_MAINNET : INK_SEPOLIA;
        const symbol = (await fetchSymbols(network))[s.product];
        if (symbol) setFills(await fetchMatches(network, s.subaccount, [symbol.product_id], 10));
      } catch (e: any) {
        if (!cancelled) setError(e.message);
      }
    };
    load();
    const id = setInterval(load, 15_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (!BOT_STATUS_URL) {
    return (
      <div className="glass panel">
        <h3>Nadobot status</h3>
        <p className="muted" style={{ marginTop: '0.5rem' }}>
          Set <code>NEXT_PUBLIC_BOT_STATUS_URL</code> to the bot&apos;s public Railway URL to show its live status here.
        </p>
      </div>
    );
  }

  const online = status && status.lastProtectionCheckAt && Date.now() - new Date(status.lastProtectionCheckAt).getTime() < 120_000;

  return (
    <div className="glass panel">
      <div className="panel-header">
        <div>
          <h3>Nadobot status</h3>
          {status && (
            <p className="muted" style={{ marginTop: '0.4rem' }}>
              {status.product} on {status.network} · bot {status.botAddress.slice(0, 6)}…{status.botAddress.slice(-4)} · running since{' '}
              {new Date(status.startedAt).toLocaleString()}
            </p>
          )}
        </div>
        <span className={`pill ${online ? 'good' : 'bad'}`}>{status ? (online ? 'Online' : 'Not responding') : 'Connecting…'}</span>
      </div>

      {error && <div className="notice error">Could not reach the bot: {error}</div>}

      {status && (
        <>
          <div className="kv">
            <div>
              <span>Strategy</span>
              {status.strategy.dipBuyEnabled
                ? `Buy ${status.strategy.tradeAmount} on a ${status.strategy.entryDropPercent}% dip (max ${status.strategy.maxPositionSize})`
                : 'Protection only'}
            </div>
            <div>
              <span>Last price / session high</span>
              {status.lastPrice ? `${usd(status.lastPrice)} / ${usd(status.sessionHigh)}` : 'waiting for trades'}
            </div>
            <div>
              <span>Next buy triggers at</span>
              {status.entryTriggerPrice ? usd(status.entryTriggerPrice) : '—'}
            </div>
            <div>
              <span>Position</span>
              {status.position ? `${status.position.amount} @ ${usd(status.position.avgEntryPrice)}` : 'None'}
            </div>
            <div>
              <span>Protection</span>
              {status.protection
                ? `SL ${usd(status.protection.stopPrice)} · TP ${usd(status.protection.takeProfitPrice)}`
                : status.position
                  ? 'Being placed…'
                  : `SL -${status.strategy.stopLossPercent}% / TP +${status.strategy.takeProfitPercent}% on entry`}
            </div>
            <div>
              <span>Last buy · last check</span>
              {ago(status.lastBuyAt)} · {ago(status.lastProtectionCheckAt)}
            </div>
            <div>
              <span>Alerts</span>
              {status.alertsConfigured ? 'Telegram/Discord on' : 'Not configured'}
            </div>
          </div>

          {status.lastSkippedBuyReason && <div className="notice">{status.lastSkippedBuyReason}</div>}
          {status.lastError && (
            <div className="notice error">
              Last error {ago(status.lastError.at)}: {status.lastError.message}
            </div>
          )}

          <h4 style={{ marginTop: '1.5rem', marginBottom: '0.5rem' }}>Recent bot fills</h4>
          {fills.length === 0 ? (
            <p className="muted">No fills yet.</p>
          ) : (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Side</th>
                    <th>Size</th>
                    <th>Price</th>
                    <th>Fee</th>
                    <th>Realized PnL</th>
                  </tr>
                </thead>
                <tbody>
                  {fills.map((f) => (
                    <tr key={f.digest + f.submissionIdx}>
                      <td className="muted">{f.timestamp ? new Date(f.timestamp * 1000).toLocaleString() : '—'}</td>
                      <td style={{ color: f.baseFilled > 0 ? 'var(--success)' : 'var(--danger)' }}>{f.baseFilled > 0 ? 'Buy' : 'Sell'}</td>
                      <td>{Math.abs(f.baseFilled)}</td>
                      <td>{f.baseFilled ? usd(Math.abs(f.quoteFilled / f.baseFilled)) : '—'}</td>
                      <td>{usd(f.fee)}</td>
                      <td style={{ color: f.realizedPnl >= 0 ? 'var(--success)' : 'var(--danger)' }}>{f.realizedPnl ? usd(f.realizedPnl) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
