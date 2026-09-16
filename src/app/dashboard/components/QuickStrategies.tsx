'use client';

import { PRESETS, type Preset } from '@/lib/presets';

const TOOL_NAMES: Record<Preset['tool'], string> = { plan: 'Trade plan', ladder: 'Ladder', twap: 'TWAP & DCA' };

/** One tap fills the matching form with a ready-made strategy for the selected market; nothing is placed until the trader signs. */
export function QuickStrategies({ symbol, onPick }: { symbol: string; onPick: (preset: Preset) => void }) {
  return (
    <div className="glass panel">
      <div className="panel-header">
        <div>
          <h3>Quick strategies</h3>
          <p className="muted" style={{ marginTop: '0.4rem', maxWidth: 680 }}>
            Not sure where to start? Pick a strategy and it fills in the right form for {symbol}. Nothing is placed until you review it and
            sign.
          </p>
        </div>
      </div>
      <div className="strategy-grid">
        {PRESETS.map((p) => (
          <button key={p.id} className="strategy-card" onClick={() => onPick(p)}>
            <span className="pill">{TOOL_NAMES[p.tool]}</span>
            <strong>{p.title}</strong>
            <span className="muted">{p.summary}</span>
            <span className="strategy-cta">Use this →</span>
          </button>
        ))}
      </div>
    </div>
  );
}
