import fs from 'fs';
import os from 'os';
import path from 'path';
import { alertTriggered, describeAlert, parseAlert, type PriceAlert } from '../src/push/alerts';
import { PushStore, type PushRecord } from '../src/push/store';

const request = {
  chainId: 763373,
  productId: 2,
  symbol: 'BTC-PERP',
  direction: 'above' as const,
  price: 80000,
  priceWhenSet: 75000,
};
const alert = (over: Partial<PriceAlert> = {}): PriceAlert => ({
  id: 'a1',
  createdAt: new Date().toISOString(),
  ...request,
  ...over,
});

describe('parseAlert', () => {
  it('accepts a level the market has not reached yet', () => {
    const parsed = parseAlert(request);
    expect('error' in parsed).toBe(false);
    expect(parsed).toMatchObject({ symbol: 'BTC-PERP', direction: 'above', price: 80000, priceWhenSet: 75000 });
    expect((parsed as PriceAlert).id).toHaveLength(14);
  });

  it('refuses a level that is already met, which would fire at once', () => {
    expect(parseAlert({ ...request, price: 70000 })).toEqual({ error: 'That price is already above the market. Pick a higher price.' });
    expect(parseAlert({ ...request, direction: 'below', price: 80000 })).toEqual({
      error: 'That price is already below the market. Pick a lower price.',
    });
  });

  it('rejects bad input', () => {
    expect(parseAlert({ ...request, chainId: 1 })).toEqual({ error: 'Unsupported network' });
    expect(parseAlert({ ...request, symbol: 'BTC' })).toEqual({ error: 'Invalid market' });
    expect(parseAlert({ ...request, symbol: '<script>-PERP' })).toEqual({ error: 'Invalid market' });
    expect(parseAlert({ ...request, productId: 1.5 })).toEqual({ error: 'Invalid market' });
    expect(parseAlert({ ...request, direction: 'sideways' })).toEqual({ error: 'Invalid direction' });
    expect(parseAlert({ ...request, price: 0 })).toEqual({ error: 'Invalid price' });
    expect(parseAlert({ ...request, price: 'soon' })).toEqual({ error: 'Invalid price' });
    expect(parseAlert({ ...request, priceWhenSet: undefined })).toEqual({ error: 'Invalid current price' });
  });
});

describe('alertTriggered', () => {
  it('fires only as the level is crossed', () => {
    const a = alert();
    expect(alertTriggered(a, 79_000, 80_000)).toBe(true); // reached
    expect(alertTriggered(a, 79_000, 79_500)).toBe(false); // not yet
    expect(alertTriggered(a, 80_500, 81_000)).toBe(false); // already past on the previous check
  });

  it('mirrors for a level below', () => {
    const a = alert({ direction: 'below', price: 70_000, priceWhenSet: 75_000 });
    expect(alertTriggered(a, 70_500, 69_900)).toBe(true);
    expect(alertTriggered(a, 69_000, 68_000)).toBe(false);
  });

  it('uses the price when the alert was set as the first comparison', () => {
    const a = alert();
    expect(alertTriggered(a, NaN, 81_000)).toBe(true);
    expect(alertTriggered(a, 0, 79_000)).toBe(false);
  });

  it('ignores a missing or nonsense price', () => {
    expect(alertTriggered(alert(), 79_000, NaN)).toBe(false);
    expect(alertTriggered(alert(), 79_000, 0)).toBe(false);
  });

  it('describes what happened', () => {
    expect(describeAlert(alert(), 80_050)).toBe('BTC-PERP is above $80,000 (now $80,050)');
  });
});

describe('storing alerts with a subscription', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nadobot-alerts-'));
  const record: PushRecord = {
    endpoint: 'https://fcm.googleapis.com/x',
    keys: { p256dh: 'k', auth: 'a' },
    subaccount: null,
    chainId: 763373,
    topics: ['bot'],
    createdAt: new Date().toISOString(),
    lastSeenSubmissionIdx: null,
  };

  it('saves alerts against the subscription and reloads them', () => {
    const store = new PushStore(dir, 763373);
    store.upsert(record);
    expect(store.setAlerts(record.endpoint, [alert()])).toBe(true);

    const reopened = new PushStore(dir, 763373);
    expect(reopened.subscriptions[0].alerts).toHaveLength(1);
    expect(reopened.subscriptions[0].alerts![0].price).toBe(80000);
  });

  it('reports when the subscription is gone', () => {
    const store = new PushStore(dir, 763373);
    expect(store.setAlerts('https://fcm.googleapis.com/unknown', [alert()])).toBe(false);
  });

  it('keeps existing subscriptions without alerts working', () => {
    const store = new PushStore(dir, 763373);
    store.upsert({ ...record, endpoint: 'https://fcm.googleapis.com/y' });
    const reopened = new PushStore(dir, 763373);
    expect(reopened.subscriptions.find((s) => s.endpoint.endsWith('/y'))!.alerts).toBeUndefined();
  });
});
