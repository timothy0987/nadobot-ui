'use client';

import { accountLeverage, formatPrice, liquidationPrice, type AccountRisk, type TradeRisk } from '@/lib/nado';

const money = (n: number) => `${n < 0 ? '−' : ''}$${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

/**
 * What an order does to the account if it fully fills: liquidation price, leverage and margin, before and after.
 * Blocking problems (not enough margin, stop past liquidation) are shown as errors; the form disables its button.
 */
export function RiskPreview({
  account,
  risk,
  productId,
  priceIncrementX18,
}: {
  account: AccountRisk | null;
  risk: TradeRisk | null;
  productId: number;
  priceIncrementX18: string;
}) {
  if (!account) {
    return <p className="muted risk-note">Margin and liquidation estimates appear once your Nado account has a deposit.</p>;
  }
  if (!risk) return null;

  const liqBefore = liquidationPrice(account, productId);
  const leverageBefore = accountLeverage(account);
  const lev = (n: number) => (Number.isFinite(n) ? `${n.toFixed(n < 10 ? 2 : 1)}x` : '—');

  return (
    <div className="risk-preview" aria-label="Risk if fully filled">
      <p className="risk-title">If fully filled</p>
      <div className="kv">
        <div>
          <span>Est. liquidation price</span>
          {risk.liquidationPrice === null ? 'None' : formatPrice(risk.liquidationPrice, priceIncrementX18)}
          {liqBefore !== null && risk.liquidationPrice !== liqBefore && (
            <small className="muted"> (now {formatPrice(liqBefore, priceIncrementX18)})</small>
          )}
        </div>
        <div>
          <span>Account leverage</span>
          {lev(leverageBefore)} → {lev(risk.leverage)}
        </div>
        <div>
          <span>Margin used</span>
          {risk.marginUsedPercent.toFixed(0)}%
        </div>
        <div>
          <span>Margin left</span>
          <span style={{ color: risk.after.availableMargin < 0 ? 'var(--danger)' : undefined }}>
            {money(risk.after.availableMargin)} of {money(Math.max(risk.after.equity, 0))}
          </span>
        </div>
      </div>
      {risk.errors.map((e) => (
        <div key={e} className="notice error">
          {e}
        </div>
      ))}
      {risk.warnings.map((w) => (
        <div key={w} className="notice warn">
          {w}
        </div>
      ))}
    </div>
  );
}
