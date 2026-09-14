import { appendEvent, type BotEvent } from '../src/alerts';

const t0 = new Date('2026-09-14T21:00:00Z');
const plus = (ms: number) => new Date(t0.getTime() + ms);

describe('appendEvent', () => {
  it('keeps events newest first', () => {
    let log: BotEvent[] = [];
    log = appendEvent(log, 'info', 'Bot started', t0, 1);
    log = appendEvent(log, 'info', 'Bought 0.001 BTC-PERP', plus(1000), 2);
    expect(log.map((e) => e.message)).toEqual(['Bought 0.001 BTC-PERP', 'Bot started']);
  });

  it('collapses a repeating failure into one row with a count', () => {
    let log: BotEvent[] = [];
    for (let i = 0; i < 20; i++) log = appendEvent(log, 'error', 'protection: timeout', plus(i * 30_000), i + 1);
    expect(log).toHaveLength(1);
    expect(log[0].count).toBe(20);
    expect(log[0].at).toBe(plus(19 * 30_000).toISOString());
  });

  it('starts a new row when the same message comes back after 10 minutes', () => {
    let log = appendEvent([], 'error', 'protection: timeout', t0, 1);
    log = appendEvent(log, 'error', 'protection: timeout', plus(11 * 60_000), 2);
    expect(log).toHaveLength(2);
  });

  it('caps the log at 50 events', () => {
    let log: BotEvent[] = [];
    for (let i = 0; i < 60; i++) log = appendEvent(log, 'info', `event ${i}`, plus(i), i + 1);
    expect(log).toHaveLength(50);
    expect(log[0].message).toBe('event 59');
  });
});
