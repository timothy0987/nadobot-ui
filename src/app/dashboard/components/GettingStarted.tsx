'use client';

import { useEffect, useState } from 'react';
import { onboardingSteps, type OnboardingState } from '@/lib/onboarding';

/**
 * A short checklist from connected wallet to first trade: the right network, a funded Nado account, notifications, then a
 * trade. It hides itself once the trader has traded, or when they dismiss it.
 */
export function GettingStarted({ state, storageKey }: { state: OnboardingState; storageKey: string }) {
  const [dismissed, setDismissed] = useState<boolean | null>(null);

  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(storageKey) === '1');
    } catch {
      setDismissed(false);
    }
  }, [storageKey]);

  const checklist = onboardingSteps(state);
  if (dismissed !== false || checklist.loading || checklist.complete) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(storageKey, '1');
    } catch {}
    setDismissed(true);
  };
  const go = (target: string) => document.getElementById(target)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <div className="glass panel getting-started">
      <div className="panel-header">
        <div>
          <h3>Get started</h3>
          <p className="muted" style={{ marginTop: '0.3rem' }}>
            {checklist.doneCount} of {checklist.steps.length} done · a few steps from your first trade
          </p>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={dismiss}>
          Hide
        </button>
      </div>
      <div className="progress" aria-hidden>
        <div style={{ width: `${(checklist.doneCount / checklist.steps.length) * 100}%` }} />
      </div>
      <ol className="onboarding-steps">
        {checklist.steps.map((step) => {
          const isNext = checklist.next?.id === step.id;
          return (
            <li key={step.id} className={`${step.done ? 'done' : ''} ${isNext ? 'next' : ''}`}>
              <span className="step-mark" aria-hidden>
                {step.done ? '✓' : ''}
              </span>
              <div className="step-body">
                <strong>
                  {step.title}
                  {step.optional && <span className="muted"> · optional</span>}
                </strong>
                <span className="muted">{step.detail}</span>
              </div>
              {!step.done && step.action && (
                step.action.href ? (
                  <a className={`btn btn-sm ${isNext ? 'btn-primary' : 'btn-secondary'}`} href={step.action.href} target="_blank" rel="noreferrer">
                    {step.action.label}
                  </a>
                ) : (
                  <button className={`btn btn-sm ${isNext ? 'btn-primary' : 'btn-secondary'}`} onClick={() => go(step.action!.scrollTo!)}>
                    {step.action.label}
                  </button>
                )
              )}
              <span className="sr-only">{step.done ? 'Done' : 'Not done'}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
