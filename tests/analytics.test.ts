import { afterEach, describe, expect, it, vi } from 'vitest';
import { eventPayload, trackingDeclined } from '../src/lib/analytics';
import { summarizeStats, type StatsResponse } from '../src/lib/stats';

describe('anonymous usage events', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('carries only the event, network and a rounded order value', () => {
    expect(eventPayload('ladder_placed', 57073, 1234.567)).toEqual({ name: 'ladder_placed', chainId: 57073, valueUsd: 1234.57 });
    expect(Object.keys(eventPayload('alert_set', 57073))).toEqual(['name', 'chainId', 'valueUsd']);
  });

  it('never sends a negative or broken value', () => {
    expect(eventPayload('plan_created', 57073, -5).valueUsd).toBe(0);
    expect(eventPayload('plan_created', 57073, NaN).valueUsd).toBe(0);
  });

  it('respects Do Not Track and Global Privacy Control', () => {
    expect(trackingDeclined({ doNotTrack: '1' })).toBe(true);
    expect(trackingDeclined({ globalPrivacyControl: true })).toBe(true);
    expect(trackingDeclined({ doNotTrack: '0', globalPrivacyControl: false })).toBe(false);
    expect(trackingDeclined(undefined)).toBe(false);
  });
});

describe('stats page numbers', () => {
  const data: StatsResponse = {
    days: 2,
    from: '2026-09-09',
    to: '2026-09-10',
    totals: {
      '57073': {
        wallet_connected: { count: 12, valueUsd: 0 },
        plan_created: { count: 3, valueUsd: 1500 },
        ladder_placed: { count: 1, valueUsd: 4000 },
        position_closed: { count: 2, valueUsd: 900 },
        alert_set: { count: 5, valueUsd: 0 },
        card_shared: { count: 4, valueUsd: 0 },
      },
      '763373': { plan_created: { count: 99, valueUsd: 99999 } },
    },
    daily: [
      { day: '2026-09-09', byChain: { '57073': { events: 4, valueUsd: 1500 } } },
      { day: '2026-09-10', byChain: { '763373': { events: 99, valueUsd: 99999 } } },
    ],
  };

  it('adds up order value from order-placing tools only, per network', () => {
    const s = summarizeStats(data, 57073);
    expect(s.orderValueUsd).toBe(6400); // plans + ladder + closes; alerts and shares carry no order value
    expect(s.orderActions).toBe(6);
    expect(s.walletSessions).toBe(12);
    expect(s.shares).toBe(4);
    expect(s.daily).toEqual([
      { day: '2026-09-09', valueUsd: 1500 },
      { day: '2026-09-10', valueUsd: 0 },
    ]);
  });

  it('lists tools most used first, without wallet sessions', () => {
    const tools = summarizeStats(data, 57073).tools;
    expect(tools[0]).toEqual({ name: 'alert_set', count: 5, valueUsd: 0 });
    expect(tools.map((t) => t.name as string)).not.toContain('wallet_connected');
  });

  it('shows zeros for a network with no activity', () => {
    expect(summarizeStats({ ...data, totals: {} }, 57073).orderValueUsd).toBe(0);
  });
});
