'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ProductSymbol } from '@/lib/nado';

// Most-traded markets first; everything else alphabetically.
const PINNED = ['BTC-PERP', 'ETH-PERP', 'SOL-PERP'];

/** Every perp market Nado currently trades, with pinned majors first. */
export function tradableMarkets(symbols: Record<string, ProductSymbol>) {
  return Object.values(symbols)
    .filter((s) => s.type === 'perp' && s.trading_status === 'live')
    .sort((a, b) => {
      const pa = PINNED.indexOf(a.symbol);
      const pb = PINNED.indexOf(b.symbol);
      if (pa !== -1 || pb !== -1) return (pa === -1 ? 99 : pa) - (pb === -1 ? 99 : pb);
      return a.symbol.localeCompare(b.symbol);
    });
}

/** Searchable market selector: type to filter, arrow keys to move, Enter to pick. */
export function MarketPicker({
  markets,
  value,
  onChange,
}: {
  markets: ProductSymbol[];
  value: string;
  onChange: (symbol: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const filtered = useMemo(() => {
    const q = query.trim().toUpperCase();
    return q ? markets.filter((m) => m.symbol.replace('-PERP', '').includes(q)) : markets;
  }, [markets, query]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    inputRef.current?.focus();
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  function pick(symbol: string) {
    onChange(symbol);
    setOpen(false);
    setQuery('');
    setActive(0);
  }

  return (
    <div className="market-picker" ref={rootRef}>
      <button
        type="button"
        className="market-picker-button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="muted">Market</span>
        <strong>{value.replace('-PERP', '')}</strong>
        <span className="muted">-PERP ▾</span>
      </button>
      {open && (
        <div className="market-picker-menu glass">
          <input
            ref={inputRef}
            type="search"
            placeholder={`Search ${markets.length} markets`}
            value={query}
            role="combobox"
            aria-controls={listId}
            aria-expanded
            aria-activedescendant={filtered[active] ? `${listId}-${filtered[active].product_id}` : undefined}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((i) => Math.min(i + 1, filtered.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((i) => Math.max(i - 1, 0));
              } else if (e.key === 'Enter' && filtered[active]) {
                pick(filtered[active].symbol);
              } else if (e.key === 'Escape') {
                setOpen(false);
              }
            }}
          />
          <ul id={listId} role="listbox" aria-label="Markets">
            {filtered.length === 0 && <li className="muted market-empty">No market matches “{query}”.</li>}
            {filtered.map((m, i) => (
              <li
                key={m.product_id}
                id={`${listId}-${m.product_id}`}
                role="option"
                aria-selected={m.symbol === value}
                className={`${i === active ? 'active' : ''} ${m.symbol === value ? 'current' : ''}`}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(m.symbol);
                }}
              >
                {m.symbol.replace('-PERP', '')}
                <span className="muted">-PERP</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
