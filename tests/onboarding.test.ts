import { describe, expect, it } from 'vitest';
import { onboardingSteps, type OnboardingState } from '../src/lib/onboarding';

const fresh: OnboardingState = {
  onSupportedChain: true,
  isMainnet: true,
  accountExists: false,
  equity: 0,
  pushEnabled: false,
  pushSupported: true,
  hasTraded: false,
};

describe('getting started checklist', () => {
  it('points a brand-new mainnet wallet at depositing first', () => {
    const c = onboardingSteps(fresh);
    expect(c.steps.map((s) => s.id)).toEqual(['network', 'fund', 'notifications', 'trade']);
    expect(c.next?.id).toBe('fund');
    expect(c.steps[1].action).toEqual({ label: 'Deposit on Nado', href: 'https://app.nado.xyz' });
    expect(c.complete).toBe(false);
    expect(c.doneCount).toBe(1);
  });

  it('sends testnet wallets to the faucet instead', () => {
    const c = onboardingSteps({ ...fresh, isMainnet: false });
    expect(c.steps[1].action?.href).toBe('https://testnet.nado.xyz/portfolio/faucet');
    expect(c.steps[0].detail).toMatch(/practice funds/);
  });

  it('asks for the right network before anything else', () => {
    expect(onboardingSteps({ ...fresh, onSupportedChain: false }).next?.id).toBe('network');
  });

  it('needs at least the $5 minimum to count as funded', () => {
    expect(onboardingSteps({ ...fresh, accountExists: true, equity: 4.99 }).next?.id).toBe('fund');
    expect(onboardingSteps({ ...fresh, accountExists: true, equity: 5 }).next?.id).toBe('trade');
  });

  it('is complete after the first trade, even with notifications off', () => {
    const c = onboardingSteps({ ...fresh, accountExists: true, equity: 250, hasTraded: true });
    expect(c.complete).toBe(true);
    expect(c.next?.id).toBe('notifications'); // the optional step can still be offered
  });

  it('skips notifications where the browser cannot show them', () => {
    const c = onboardingSteps({ ...fresh, pushSupported: false });
    expect(c.steps[2].done).toBe(true);
    expect(c.steps[2].action).toBeUndefined();
  });

  it('reports loading until the account and fills are known', () => {
    expect(onboardingSteps({ ...fresh, accountExists: null }).loading).toBe(true);
    expect(onboardingSteps({ ...fresh, hasTraded: null }).loading).toBe(true);
    expect(onboardingSteps(fresh).loading).toBe(false);
  });

  it('has nothing left when every step is done', () => {
    const c = onboardingSteps({ ...fresh, accountExists: true, equity: 100, pushEnabled: true, hasTraded: true });
    expect(c.doneCount).toBe(4);
    expect(c.next).toBeNull();
  });
});
