import { describe, expect, it } from 'vitest';
import { reminderFor, renewalDraft, type SavedSchedule } from '../src/lib/renewal';

const digest = `0x${'ab'.repeat(32)}`;
const dca: SavedSchedule = {
  digest,
  chainId: 57073,
  sender: '0x',
  productId: 2,
  symbol: 'BTC-PERP',
  mode: 'dca',
  side: 'buy',
  size: 0.0133,
  executions: 7,
  intervalSeconds: 14400,
  createdAt: 0,
};

describe('renewing a finished DCA', () => {
  it('fills in the same side, size, frequency and length', () => {
    expect(renewalDraft([dca], digest, 57073, 2)).toEqual({ side: 'buy', amount: '0.0133', intervalSeconds: 14400, hours: '24' });
  });

  it('matches the digest regardless of case', () => {
    expect(renewalDraft([dca], digest.toUpperCase().replace('0X', '0x'), 57073, 2)).not.toBeNull();
  });

  it('only renews a DCA from this network and market', () => {
    expect(renewalDraft([dca], digest, 763373, 2)).toBeNull();
    expect(renewalDraft([dca], digest, 57073, 4)).toBeNull();
    expect(renewalDraft([{ ...dca, mode: 'twap' }], digest, 57073, 2)).toBeNull();
    expect(renewalDraft([], digest, 57073, 2)).toBeNull();
  });

  it('keeps the schedule within the form’s limits', () => {
    expect(renewalDraft([{ ...dca, intervalSeconds: 600, executions: 200 }], digest, 57073, 2)).toEqual({
      side: 'buy',
      amount: '0.0133',
      intervalSeconds: 3600, // not a DCA frequency the form offers: falls back to hourly
      hours: '24', // capped by Nado's 25-hour limit
    });
    expect(renewalDraft([{ ...dca, intervalSeconds: 900, executions: 2 }], digest, 57073, 2)?.hours).toBe('1');
  });
});

describe('the reminder sent to the bot', () => {
  it('ends when the last execution is due', () => {
    const r = reminderFor({ digest, chainId: 57073, productId: 2, symbol: 'BTC-PERP', side: 'sell', size: 0.5, durationSeconds: 86400, nowSeconds: 1000 });
    expect(r).toEqual({ digest, chainId: 57073, productId: 2, symbol: 'BTC-PERP', side: 'sell', size: 0.5, hours: 24, endsAt: 87400 });
  });
});
