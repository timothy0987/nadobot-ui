/** Everything the checklist needs to know, all of it already loaded by the dashboard. */
export interface OnboardingState {
  onSupportedChain: boolean;
  isMainnet: boolean;
  /** null while the Nado account is still loading. */
  accountExists: boolean | null;
  /** Account value in USD, null while loading. */
  equity: number | null;
  pushEnabled: boolean;
  pushSupported: boolean;
  /** null while fills are loading. */
  hasTraded: boolean | null;
}

export type StepId = 'network' | 'fund' | 'notifications' | 'trade';

export interface OnboardingStep {
  id: StepId;
  title: string;
  detail: string;
  done: boolean;
  optional: boolean;
  /** Where the step's action points: a link out, or a section of the dashboard to scroll to. */
  action?: { label: string; href?: string; scrollTo?: string };
}

/** Nado's minimum deposit to activate an account. */
export const MIN_DEPOSIT_USD = 5;

/** Pure: the checklist for a connected wallet, in order, with the first unfinished required step as `next`. */
export function onboardingSteps(s: OnboardingState) {
  const funded = s.accountExists === true && (s.equity ?? 0) >= MIN_DEPOSIT_USD;
  const steps: OnboardingStep[] = [
    {
      id: 'network',
      title: 'Use a Nado network',
      detail: s.onSupportedChain
        ? `You're on ${s.isMainnet ? 'mainnet, trading real funds' : 'testnet, with practice funds'}.`
        : 'Pick Testnet or Mainnet at the top so your wallet signs for the right network.',
      done: s.onSupportedChain,
      optional: false,
    },
    {
      id: 'fund',
      title: 'Fund your Nado account',
      detail: funded
        ? 'Your Nado account has funds to trade with.'
        : s.isMainnet
          ? `Deposit at least $${MIN_DEPOSIT_USD} USDT0 on Nado. Deposits always happen on Nado itself, never in Nadobot.`
          : `Claim free testnet funds from Nado's faucet (at least $${MIN_DEPOSIT_USD} USDT0) to practise.`,
      done: funded,
      optional: false,
      action: funded
        ? undefined
        : s.isMainnet
          ? { label: 'Deposit on Nado', href: 'https://app.nado.xyz' }
          : { label: 'Open the testnet faucet', href: 'https://testnet.nado.xyz/portfolio/faucet' },
    },
    {
      id: 'notifications',
      title: 'Turn on notifications',
      detail: s.pushSupported
        ? 'Get told when your orders fill and when prices you watch are reached, even with the dashboard closed.'
        : "This browser can't show push notifications, so you can skip this.",
      done: s.pushEnabled || !s.pushSupported,
      optional: true,
      action: s.pushEnabled || !s.pushSupported ? undefined : { label: 'Turn on', scrollTo: 'push-settings' },
    },
    {
      id: 'trade',
      title: 'Place your first trade',
      detail: 'Buy or sell now with Trade now, or tap a quick strategy to have a plan filled in for you to review.',
      done: s.hasTraded === true,
      optional: false,
      action: s.hasTraded ? undefined : { label: 'Start trading', scrollTo: 'trade-now' },
    },
  ];
  const loading = s.accountExists === null || s.hasTraded === null;
  const required = steps.filter((st) => !st.optional);
  return {
    steps,
    loading,
    doneCount: steps.filter((st) => st.done).length,
    /** Complete once every required step is done; the optional one never holds it open. */
    complete: required.every((st) => st.done),
    next: steps.find((st) => !st.done && !st.optional) ?? steps.find((st) => !st.done) ?? null,
  };
}
