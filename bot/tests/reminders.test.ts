import { buildSubscriptionRecord } from '../src/push/service';
import { describeReminder, dueReminders, executionState, parseReminder, shouldRemind, type ScheduleReminder } from '../src/push/reminders';
import type { PushRecord } from '../src/push/store';
import type { PriceAlert } from '../src/push/alerts';

const now = 1_790_000_000;
const digest = `0x${'ab'.repeat(32)}`;
const request = { chainId: 57073, digest, productId: 2, symbol: 'BTC-PERP', side: 'buy', size: 0.0133, hours: 24, endsAt: now + 24 * 3600 };
const reminder = (over: Partial<ScheduleReminder> = {}): ScheduleReminder => ({
  ...(request as ScheduleReminder),
  createdAt: new Date(now * 1000).toISOString(),
  ...over,
});

describe('parseReminder', () => {
  it('accepts a schedule ending within Nado’s 25-hour limit', () => {
    expect(parseReminder(request, now)).toMatchObject({ digest, symbol: 'BTC-PERP', side: 'buy', endsAt: now + 86400 });
  });

  it('normalises the digest to lowercase', () => {
    expect(parseReminder({ ...request, digest: digest.toUpperCase().replace('0X', '0x') }, now)).toMatchObject({ digest });
  });

  it('rejects bad input', () => {
    expect(parseReminder({ ...request, chainId: 1 }, now)).toEqual({ error: 'Unsupported network' });
    expect(parseReminder({ ...request, digest: '0x1234' }, now)).toEqual({ error: 'Invalid schedule' });
    expect(parseReminder({ ...request, symbol: 'BTC' }, now)).toEqual({ error: 'Invalid market' });
    expect(parseReminder({ ...request, side: 'hold' }, now)).toEqual({ error: 'Invalid side' });
    expect(parseReminder({ ...request, size: -1 }, now)).toEqual({ error: 'Invalid schedule' });
    expect(parseReminder({ ...request, hours: 48 }, now)).toEqual({ error: 'Invalid schedule' });
    expect(parseReminder({ ...request, endsAt: now - 10 }, now)).toEqual({ error: 'Invalid end time' });
    expect(parseReminder({ ...request, endsAt: now + 30 * 3600 }, now)).toEqual({ error: 'Invalid end time' });
  });
});

describe('when to remind', () => {
  it('waits a minute past the last execution', () => {
    const r = reminder({ endsAt: now });
    expect(dueReminders([r], now + 59)).toEqual([]);
    expect(dueReminders([r], now + 60)).toEqual([r]);
  });

  it('reminds for a schedule that ran its course, even with some failed slices', () => {
    expect(shouldRemind(['executed', 'executed'])).toBe(true);
    expect(shouldRemind(['executed', 'failed'])).toBe(true);
    expect(shouldRemind([])).toBe(true);
  });

  it('stays quiet for a cancelled schedule, and waits while one is still executing', () => {
    expect(shouldRemind(['executed', 'cancelled'])).toBe(false);
    expect(shouldRemind(['executed', 'pending'])).toBe(false);
  });

  it("reads Nado's execution statuses", () => {
    expect(executionState('pending')).toBe('pending');
    expect(executionState({ executed: { digest: '0x' } })).toBe('executed');
    expect(executionState({ failed: 'insufficient health' })).toBe('failed');
    expect(executionState({ cancelled: 'user' })).toBe('cancelled');
  });

  it('writes a notification that says what to do', () => {
    expect(describeReminder(reminder())).toBe('Your BTC-PERP DCA (buy 0.0133 BTC over 24 h) has finished. Tap to start the next one.');
  });
});

describe('re-subscribing a device', () => {
  const input = {
    endpoint: 'https://fcm.googleapis.com/x',
    keys: { p256dh: 'k', auth: 'a' },
    subaccount: null,
    topics: ['bot' as const],
    chainId: 57073,
  };
  const alert = { id: 'a1', chainId: 57073, productId: 2, symbol: 'BTC-PERP', direction: 'above', price: 90000, priceWhenSet: 75000, createdAt: '' } as PriceAlert;

  it('keeps the price alerts and reminders the device already set up', () => {
    const existing: PushRecord = {
      ...input,
      createdAt: '2026-09-01T00:00:00.000Z',
      lastSeenSubmissionIdx: '5',
      alerts: [alert],
      reminders: [reminder()],
    };
    const record = buildSubscriptionRecord({ ...input, topics: ['bot', 'fills'], subaccount: `0x${'11'.repeat(32)}` }, 57073, existing, '9');
    expect(record.alerts).toEqual([alert]);
    expect(record.reminders).toEqual([reminder()]);
    expect(record.createdAt).toBe('2026-09-01T00:00:00.000Z');
    expect(record.topics).toEqual(['bot', 'fills']);
    expect(record.lastSeenSubmissionIdx).toBe('9');
  });

  it('starts empty for a new device', () => {
    const record = buildSubscriptionRecord(input, 57073, undefined, null);
    expect(record.alerts).toBeUndefined();
    expect(record.reminders).toBeUndefined();
  });
});
