import fs from 'fs';
import os from 'os';
import path from 'path';
import { parseEvent, recordEvent, summarizeUsage, UsageStore, type UsageData } from '../src/analytics';

const day = (iso: string) => new Date(`${iso}T12:00:00Z`);

describe('parseEvent', () => {
  it('accepts a known event with an order value', () => {
    expect(parseEvent({ name: 'ladder_placed', chainId: 57073, valueUsd: 1234.567 })).toEqual({ name: 'ladder_placed', chainId: 57073, valueUsd: 1234.57 });
  });

  it('defaults the value to zero', () => {
    expect(parseEvent({ name: 'alert_set', chainId: 763373 })).toEqual({ name: 'alert_set', chainId: 763373, valueUsd: 0 });
  });

  it('rejects anything unexpected instead of storing it', () => {
    expect(parseEvent({ name: 'page_view', chainId: 57073 })).toEqual({ error: 'Unknown event' });
    expect(parseEvent({ name: 'plan_created', chainId: 1 })).toEqual({ error: 'Unsupported network' });
    expect(parseEvent({ name: 'plan_created', chainId: 57073, valueUsd: -5 })).toEqual({ error: 'Invalid value' });
    expect(parseEvent({ name: 'plan_created', chainId: 57073, valueUsd: 'lots' })).toEqual({ error: 'Invalid value' });
    expect(parseEvent({ name: 'plan_created', chainId: 57073, valueUsd: 1e12 })).toEqual({ error: 'Invalid value' });
  });

  it('never keeps extra fields such as a wallet address', () => {
    const parsed = parseEvent({ name: 'plan_created', chainId: 57073, valueUsd: 10, wallet: '0xabc', ip: '1.2.3.4' });
    expect(Object.keys(parsed).sort()).toEqual(['chainId', 'name', 'valueUsd']);
  });
});

describe('tallies', () => {
  it('counts events and adds up value per day, network and event', () => {
    let data: UsageData = {};
    data = recordEvent(data, { name: 'plan_created', chainId: 57073, valueUsd: 500 }, day('2026-09-10'));
    data = recordEvent(data, { name: 'plan_created', chainId: 57073, valueUsd: 250.5 }, day('2026-09-10'));
    data = recordEvent(data, { name: 'plan_created', chainId: 763373, valueUsd: 100 }, day('2026-09-10'));
    expect(data['2026-09-10']['57073'].plan_created).toEqual({ count: 2, valueUsd: 750.5 });
    expect(data['2026-09-10']['763373'].plan_created).toEqual({ count: 1, valueUsd: 100 });
  });

  it('keeps 180 days of history', () => {
    let data: UsageData = {};
    data = recordEvent(data, { name: 'alert_set', chainId: 57073, valueUsd: 0 }, day('2026-01-01'));
    data = recordEvent(data, { name: 'alert_set', chainId: 57073, valueUsd: 0 }, day('2026-09-10'));
    expect(Object.keys(data)).toEqual(['2026-09-10']);
  });

  it('summarizes a period with empty days filled in', () => {
    let data: UsageData = {};
    data = recordEvent(data, { name: 'twap_started', chainId: 57073, valueUsd: 1000 }, day('2026-09-08'));
    data = recordEvent(data, { name: 'position_closed', chainId: 57073, valueUsd: 400 }, day('2026-09-10'));
    const s = summarizeUsage(data, 3, day('2026-09-10'));
    expect(s.from).toBe('2026-09-08');
    expect(s.to).toBe('2026-09-10');
    expect(s.daily.map((d) => d.day)).toEqual(['2026-09-08', '2026-09-09', '2026-09-10']);
    expect(s.daily[1].byChain).toEqual({});
    expect(s.daily[0].byChain['57073']).toEqual({ events: 1, valueUsd: 1000 });
    expect(s.totals['57073']).toEqual({ twap_started: { count: 1, valueUsd: 1000 }, position_closed: { count: 1, valueUsd: 400 } });
  });

  it('clamps the requested period', () => {
    expect(summarizeUsage({}, 0, day('2026-09-10')).days).toBe(30);
    expect(summarizeUsage({}, 9999, day('2026-09-10')).days).toBe(180);
  });
});

describe('UsageStore', () => {
  it('persists tallies across restarts', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nadobot-usage-'));
    const store = new UsageStore(dir);
    store.record({ name: 'card_shared', chainId: 57073, valueUsd: 0 }, day('2026-09-10'));
    store.flush();
    const reopened = new UsageStore(dir);
    expect(reopened.summary(1, day('2026-09-10')).totals['57073'].card_shared).toEqual({ count: 1, valueUsd: 0 });
  });
});
