'use client';

import { useEffect, useState } from 'react';
import type { PushSupport, PushTopic } from '../notifications';

interface Props {
  support: PushSupport;
  enabled: boolean;
  topics: PushTopic[];
  busy: boolean;
  error: string | null;
  walletConnected: boolean;
  enable: (topics: PushTopic[]) => void;
  disable: () => void;
}

/** Turn web push on/off and choose what to be notified about. Works with the dashboard closed. */
export function PushSettings({ support, enabled, topics, busy, error, walletConnected, enable, disable }: Props) {
  const [wanted, setWanted] = useState<PushTopic[]>(topics);
  useEffect(() => setWanted(topics), [topics]);

  const toggle = (t: PushTopic) => setWanted((w) => (w.includes(t) ? w.filter((x) => x !== t) : [...w, t]));
  const changed = wanted.slice().sort().join() !== topics.slice().sort().join();
  const nothingSelected = wanted.length === 0 || (wanted.length === 1 && wanted[0] === 'fills' && !walletConnected);

  return (
    <div className="glass panel">
      <div className="panel-header">
        <div>
          <h3>Push notifications</h3>
          <p className="muted" style={{ marginTop: '0.4rem', maxWidth: 640 }}>
            Get notified on this device when your orders fill or Nadobot does something, even with this dashboard closed.
          </p>
        </div>
        <span className={`pill ${enabled ? 'good' : ''}`}>{enabled ? 'On' : 'Off'}</span>
      </div>

      {support === 'checking' && <p className="muted">Checking browser support…</p>}
      {support === 'unsupported' && <div className="notice">This browser doesn&apos;t support web push. Try Chrome, Edge, Firefox or Safari.</div>}
      {support === 'ios-install' && (
        <div className="notice">
          On iPhone or iPad, push works once the dashboard is on your Home Screen: tap <strong>Share</strong> →{' '}
          <strong>Add to Home Screen</strong>, open Nadobot from there, and enable notifications.
        </div>
      )}

      {support === 'supported' && (
        <>
          <div className="form-row" style={{ gap: '1.5rem' }}>
            <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', opacity: walletConnected ? 1 : 0.6 }}>
              <input type="checkbox" checked={wanted.includes('fills')} onChange={() => toggle('fills')} />
              My order fills{walletConnected ? '' : ' (connect a wallet)'}
            </label>
            <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <input type="checkbox" checked={wanted.includes('bot')} onChange={() => toggle('bot')} />
              Nadobot activity (buys, stop-loss/take-profit, loss limit, errors)
            </label>
          </div>
          <div className="form-row">
            {!enabled && (
              <button className="btn btn-primary btn-sm" onClick={() => enable(wanted)} disabled={busy || nothingSelected}>
                {busy ? 'Turning on…' : 'Turn on push notifications'}
              </button>
            )}
            {enabled && changed && (
              <button className="btn btn-primary btn-sm" onClick={() => enable(wanted)} disabled={busy || nothingSelected}>
                {busy ? 'Saving…' : 'Save'}
              </button>
            )}
            {enabled && (
              <button className="btn btn-secondary btn-sm" onClick={disable} disabled={busy}>
                Turn off
              </button>
            )}
          </div>
          {enabled && !changed && !error && (
            <p className="muted" style={{ marginTop: '0.75rem' }}>
              You&apos;ll get a confirmation notification when this is first turned on. Allow this site in your system notification settings too.
            </p>
          )}
        </>
      )}

      {error && <div className="notice error">{error}</div>}
    </div>
  );
}
