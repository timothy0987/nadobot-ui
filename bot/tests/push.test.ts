import { isAllowedPushEndpoint, parseSubscribe } from '../src/push/validate';
import { selectNewFills, describeFill, type ArchiveFill } from '../src/push/service';

const P256DH = 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM';
const AUTH = 'tBHItJI5svbpez7KI4CCXg';
const SUBACCOUNT = '0x9319492e613205a4409b939434e3237c210a90f064656661756c740000000000';
const sub = (endpoint: string) => ({ endpoint, keys: { p256dh: P256DH, auth: AUTH } });

describe('isAllowedPushEndpoint', () => {
  it.each([
    'https://fcm.googleapis.com/fcm/send/abc123',
    'https://updates.push.services.mozilla.com/wpush/v2/abc',
    'https://web.push.apple.com/QF2abc',
    'https://wns2-by3p.notify.windows.com/w/?token=abc',
  ])('accepts real browser push services: %s', (url) => {
    expect(isAllowedPushEndpoint(url)).toBe(true);
  });

  it.each([
    'http://fcm.googleapis.com/fcm/send/abc', // not https
    'https://169.254.169.254/latest/meta-data', // cloud metadata (SSRF)
    'https://localhost:8080/status',
    'https://fcm.googleapis.com.evil.example/send', // lookalike host
    'https://evilnotify.windows.com/w', // suffix must include the dot
    'https://user:pass@fcm.googleapis.com/send',
    'https://fcm.googleapis.com:8443/send',
    'not a url',
    42,
  ])('rejects anything else: %s', (url) => {
    expect(isAllowedPushEndpoint(url)).toBe(false);
  });
});

describe('parseSubscribe', () => {
  it('accepts a wallet fill subscription and lowercases the subaccount', () => {
    const r = parseSubscribe({ subscription: sub('https://fcm.googleapis.com/fcm/send/abc'), subaccount: SUBACCOUNT.toUpperCase().replace('0X', '0x'), topics: ['fills', 'bot'] });
    expect('error' in r).toBe(false);
    if (!('error' in r)) {
      expect(r.subaccount).toBe(SUBACCOUNT);
      expect(r.topics.sort()).toEqual(['bot', 'fills']);
    }
  });

  it('allows bot-only notifications without a wallet', () => {
    expect('error' in parseSubscribe({ subscription: sub('https://fcm.googleapis.com/fcm/send/abc'), topics: ['bot'] })).toBe(false);
  });

  it('requires a wallet for fill notifications', () => {
    expect(parseSubscribe({ subscription: sub('https://fcm.googleapis.com/fcm/send/abc'), topics: ['fills'] })).toEqual({ error: 'Fill notifications need a connected wallet' });
  });

  it('rejects bad endpoints, keys, topics and subaccounts', () => {
    const ok = { subscription: sub('https://fcm.googleapis.com/fcm/send/abc'), subaccount: SUBACCOUNT, topics: ['fills'] };
    expect(parseSubscribe({ ...ok, subscription: sub('https://example.com/hook') })).toEqual({ error: 'Unsupported push endpoint' });
    expect(parseSubscribe({ ...ok, subscription: { ...ok.subscription, keys: { p256dh: 'x', auth: AUTH } } })).toEqual({ error: 'Invalid p256dh key' });
    expect(parseSubscribe({ ...ok, subscription: { ...ok.subscription, keys: { p256dh: P256DH, auth: '<script>' } } })).toEqual({ error: 'Invalid auth key' });
    expect(parseSubscribe({ ...ok, topics: ['everything'] })).toEqual({ error: 'Invalid topics' });
    expect(parseSubscribe({ ...ok, subaccount: '0x1234' })).toEqual({ error: 'Invalid subaccount' });
  });
});

const fill = (idx: number, base: number, quote: number, pnl = 0): ArchiveFill => ({ submissionIdx: BigInt(idx), productId: 2, baseFilled: base, quoteFilled: quote, realizedPnl: pnl });

describe('selectNewFills', () => {
  const fills = [fill(105, -0.001, 86.8, 7.9), fill(103, 0.001, -78.9), fill(100, 0.002, -158)];

  it('returns only fills after the last one announced, oldest first', () => {
    const r = selectNewFills(fills, '100');
    expect(r.toPush.map((f) => Number(f.submissionIdx))).toEqual([103, 105]);
    expect(r.newest).toBe(105n);
  });

  it('announces nothing when there is nothing new', () => {
    expect(selectNewFills(fills, '105')).toEqual({ toPush: [], newest: null });
  });

  it('caps a burst so a busy wallet cannot be spammed', () => {
    const many = Array.from({ length: 20 }, (_, i) => fill(200 + i, 0.001, -79));
    const r = selectNewFills(many, '199', 5);
    expect(r.toPush.map((f) => Number(f.submissionIdx))).toEqual([215, 216, 217, 218, 219]);
    expect(r.newest).toBe(219n);
  });
});

describe('describeFill', () => {
  it('reads like a trade confirmation', () => {
    expect(describeFill(fill(1, 0.001, -78.88801), 'BTC-PERP')).toBe('Bought 0.001 BTC-PERP at $78,888.01');
    expect(describeFill(fill(2, -0.001, 86.777, 7.89), 'BTC-PERP')).toBe('Sold 0.001 BTC-PERP at $86,777 · realized +$7.89');
  });
});

import fs from 'fs';
import os from 'os';
import path from 'path';
import { PushStore } from '../src/push/store';

describe('multi-network push', () => {
  it('rejects networks Nado does not run on', () => {
    const body = { subscription: sub('https://fcm.googleapis.com/fcm/send/abc'), subaccount: SUBACCOUNT, topics: ['fills'] };
    expect(parseSubscribe({ ...body, chainId: 1 })).toEqual({ error: 'Unsupported network' });
    const ok = parseSubscribe({ ...body, chainId: 57073 });
    expect('error' in ok ? null : ok.chainId).toBe(57073);
  });

  it('backfills the network on records saved before it existed, and tracks last-seen per network', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nadobot-push-'));
    const legacy = { endpoint: 'https://fcm.googleapis.com/fcm/send/old', keys: { p256dh: P256DH, auth: AUTH }, subaccount: SUBACCOUNT, topics: ['fills' as const], createdAt: 'x', lastSeenSubmissionIdx: '5' };
    fs.writeFileSync(path.join(dir, 'push.json'), JSON.stringify({ vapid: { publicKey: 'p', privateKey: 'k' }, subscriptions: [legacy] }));

    const store = new PushStore(dir, 763373);
    expect(store.subscriptions[0].chainId).toBe(763373);

    store.upsert({ ...legacy, endpoint: 'https://fcm.googleapis.com/fcm/send/new', chainId: 57073, lastSeenSubmissionIdx: '1' });
    store.setLastSeen(763373, SUBACCOUNT, '9');
    const byEndpoint = Object.fromEntries(store.subscriptions.map((s) => [s.endpoint.split('/').pop(), s.lastSeenSubmissionIdx]));
    expect(byEndpoint).toEqual({ old: '9', new: '1' }); // the same wallet on mainnet is unaffected

    const reloaded = new PushStore(dir, 763373);
    expect(reloaded.subscriptions.map((s) => s.chainId)).toEqual([763373, 57073]);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
