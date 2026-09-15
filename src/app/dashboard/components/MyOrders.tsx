'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  cancelLadder,
  cancelOrders,
  planTriggerEdit,
  priceInputValue,
  replaceTriggerOrder,
  fetchOpenOrders,
  formatPrice,
  fromX18,
  isReduceOnly,
  describeTwap,
  listTriggerOrders,
  type NadoNetwork,
  type ProductSymbol,
  type SignTypedDataAsync,
  type TriggerOrderEntry,
} from '@/lib/nado';
import { ladderRoles, type SavedLadder } from './LadderForm';

interface Props {
  network: NadoNetwork;
  bid: number | null;
  ask: number | null;
  sign: SignTypedDataAsync;
  sender: `0x${string}`;
  product: ProductSymbol;
  refreshKey: number;
}

interface Row {
  key: string;
  kind: string;
  side: 'Buy' | 'Sell';
  size: number;
  price: string;
  status: string;
  service: 'gateway' | 'trigger';
  digest: string;
  linkedTo?: string;
  /** Set on a ladder's first entry: cancelling it alone would strip the exits from the deeper entries. */
  ladder?: SavedLadder;
  /** Present on a stop-loss or take-profit: what is needed to re-place it at another price. */
  movable?: { amount: bigint; above: boolean; triggerPrice: number; dependsOn?: string };
}


// Plain statuses are strings; a running TWAP reports {twap_executing: {current_execution, total_executions}}.
function triggerStatus(status: unknown) {
  if (status === 'waiting_dependency') return 'Waiting for entry to fill';
  if (status === 'waiting_price') return 'Watching price';
  const running = (status as any)?.twap_executing;
  if (running) return `Executing ${running.current_execution} of ${running.total_executions}`;
  return typeof status === 'string' ? status.replace(/_/g, ' ') : 'Active';
}

function describeTrigger(t: TriggerOrderEntry, tick: string): Pick<Row, 'kind' | 'price' | 'linkedTo' | 'movable'> {
  if (t.order.trigger?.time_trigger) {
    const { executions, intervalSeconds } = describeTwap(t);
    const every = intervalSeconds < 3600 ? `${Math.round(intervalSeconds / 60)} min` : `${(intervalSeconds / 3600).toFixed(1)} h`;
    const limit = fromX18(t.order.order.priceX18);
    return { kind: `TWAP · ${executions}× every ${every}`, price: `${BigInt(t.order.order.amount) > 0n ? '≤' : '≥'} ${formatPrice(limit, tick)}` };
  }
  const req = t.order.trigger?.price_trigger?.price_requirement ?? {};
  const [condition, value] = (Object.entries(req)[0] ?? ['', '0']) as [string, string];
  const above = condition.endsWith('_above');
  const amount = BigInt(t.order.order.amount);
  let kind = 'Conditional order';
  if (isReduceOnly(t.order.order.appendix)) {
    // Closing a long is a sell: stop-loss fires below, take-profit above. Closing a short is the mirror image.
    const closingLong = amount < 0n;
    kind = closingLong === above ? 'Take-profit' : 'Stop-loss';
  }
  const dependsOn = t.order.trigger?.price_trigger?.dependency?.digest;
  return {
    kind,
    price: `${above ? '≥' : '≤'} ${formatPrice(fromX18(value), tick)}`,
    linkedTo: dependsOn,
    // Only exits can be moved: a conditional order that opens a position would change its own meaning.
    movable: isReduceOnly(t.order.order.appendix) ? { amount, above, triggerPrice: fromX18(value), dependsOn } : undefined,
  };
}

export function MyOrders({ network, bid, ask, sign, sender, product, refreshKey }: Props) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [moving, setMoving] = useState<{ digest: string; price: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const market = bid && ask ? (bid + ask) / 2 : null;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [book, triggers] = await Promise.all([
        fetchOpenOrders(network, sender, product.product_id),
        listTriggerOrders(network, sign, sender, [product.product_id]),
      ]);
      const bookRows: Row[] = (book.orders ?? []).map((o: any) => {
        const amount = BigInt(o.amount);
        return {
          key: o.digest,
          kind: 'Limit order',
          side: amount > 0n ? 'Buy' : 'Sell',
          size: Math.abs(fromX18(o.unfilled_amount ?? o.amount)),
          price: formatPrice(fromX18(o.price_x18), product.price_increment_x18),
          status: 'Resting on orderbook',
          service: 'gateway',
          digest: o.digest,
        };
      });
      const triggerRows: Row[] = triggers.map((t) => {
        const amount = BigInt(t.order.order.amount);
        return {
          key: t.order.digest,
          ...describeTrigger(t, product.price_increment_x18),
          side: amount > 0n ? 'Buy' : 'Sell',
          size: Math.abs(fromX18(amount)),
          status: triggerStatus(t.status),
          service: 'trigger',
          digest: t.order.digest,
        };
      });
      const planEntries = new Set(triggerRows.map((r) => r.linkedTo).filter(Boolean));
      for (const r of bookRows) if (planEntries.has(r.digest)) r.kind = 'Plan entry';
      const ladders = ladderRoles(network.chainId, sender);
      for (const r of [...bookRows, ...triggerRows]) {
        const role = ladders.get(r.digest.toLowerCase());
        if (!role) continue;
        r.kind = role.label;
        r.linkedTo = undefined;
        if (role.firstRung) r.ladder = role.ladder;
      }
      setRows([...bookRows, ...triggerRows]);
    } catch (e: any) {
      setError(e.shortMessage ?? e.message);
    } finally {
      setLoading(false);
    }
  }, [network, sign, sender, product]);

  // After a plan is created, refresh automatically (the user just signed, so one more prompt is expected).
  useEffect(() => {
    if (refreshKey > 0) load();
  }, [refreshKey, load]);

  /** Places the exit at its new price before cancelling the old one, so the position is never left unprotected. */
  async function move(row: Row, plan: ReturnType<typeof planTriggerEdit>) {
    if (!row.movable) return;
    setSaving(true);
    setNotice(null);
    try {
      const result = await replaceTriggerOrder(network, sign, {
        productId: product.product_id,
        sender,
        oldDigest: row.digest,
        amount: row.movable.amount,
        plan,
        above: row.movable.above,
        dependsOn: row.movable.dependsOn,
      });
      setMoving(null);
      setNotice(
        result.oldCancelled
          ? { ok: true, text: `${row.kind} moved. The old one has been cancelled.` }
          : {
              ok: false,
              text: `The new ${row.kind.toLowerCase()} is live, but the old one could not be cancelled. Cancel it below so you don't hold two.`,
            }
      );
      await new Promise((r) => setTimeout(r, 2500));
      await load();
    } catch (e: any) {
      setNotice({ ok: false, text: `Could not move it: ${e.shortMessage ?? e.message}` });
    } finally {
      setSaving(false);
    }
  }

  async function cancel(row: Row) {
    setCancelling(row.digest);
    setError(null);
    try {
      if (row.ladder) await cancelLadder(network, sign, sender, product.product_id, row.ladder.orders, true);
      else await cancelOrders(network, sign, row.service, sender, [{ productId: product.product_id, digest: row.digest }]);
      await new Promise((r) => setTimeout(r, 3000));
      await load();
    } catch (e: any) {
      setError(`Cancel failed: ${e.shortMessage ?? e.message}`);
    } finally {
      setCancelling(null);
    }
  }

  return (
    <div className="glass panel">
      <div className="panel-header">
        <div>
          <h3>My orders &amp; plans</h3>
          <p className="muted" style={{ marginTop: '0.4rem' }}>
            Loading conditional orders needs one wallet signature (Nado keeps them private). Cancelling a plan&apos;s entry also
            cancels its stop-loss and take-profit.
          </p>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={load} disabled={loading}>
          {loading ? 'Loading…' : rows ? 'Refresh' : 'Load my orders'}
        </button>
      </div>

      {error && <div className="notice error">{error}</div>}
      {notice && <div className={`notice ${notice.ok ? 'success' : 'error'}`}>{notice.text}</div>}

      {rows && rows.length === 0 && <p className="muted">No open orders or plans on {product.symbol}.</p>}

      {rows && rows.length > 0 && (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Type</th>
                <th>Side</th>
                <th>Size</th>
                <th>Price</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.flatMap((row) => [
                <tr key={row.key}>
                  <td>
                    {row.kind}
                    {row.linkedTo && <div className="muted">part of plan {row.linkedTo.slice(0, 8)}…</div>}
                  </td>
                  <td style={{ color: row.side === 'Buy' ? 'var(--success)' : 'var(--danger)' }}>{row.side}</td>
                  <td>{row.size}</td>
                  <td>{row.price}</td>
                  <td className="muted">{row.status}</td>
                  <td style={{ textAlign: 'right' }}>
                    <span className="close-buttons">
                      {row.movable && (
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() =>
                            setMoving(
                              moving?.digest === row.digest
                                ? null
                                : { digest: row.digest, price: priceInputValue(row.movable!.triggerPrice, product.price_increment_x18) }
                            )
                          }
                          disabled={cancelling !== null || saving}
                        >
                          {moving?.digest === row.digest ? 'Close' : 'Move'}
                        </button>
                      )}
                      <button className="btn btn-secondary btn-sm" onClick={() => cancel(row)} disabled={cancelling !== null || saving}>
                        {cancelling === row.digest ? 'Cancelling…' : row.ladder ? 'Cancel ladder' : row.kind === 'Plan entry' ? 'Cancel plan' : 'Cancel'}
                      </button>
                    </span>
                  </td>
                </tr>,
                moving?.digest === row.digest && row.movable ? (
                  <MoveRow
                    key={`${row.key}-move`}
                    row={row}
                    market={market}
                    product={product}
                    price={moving.price}
                    saving={saving}
                    onPrice={(price) => setMoving({ digest: row.digest, price })}
                    onCancel={() => setMoving(null)}
                    onSave={move}
                  />
                ) : null,
              ])}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Inline editor under a stop-loss or take-profit: pick a new level, see where it would fill, then re-place it. */
function MoveRow({
  row,
  market,
  product,
  price,
  saving,
  onPrice,
  onCancel,
  onSave,
}: {
  row: Row;
  market: number | null;
  product: ProductSymbol;
  price: string;
  saving: boolean;
  onPrice: (price: string) => void;
  onCancel: () => void;
  onSave: (row: Row, plan: ReturnType<typeof planTriggerEdit>) => void;
}) {
  const closesLong = row.movable!.amount < 0n;
  const plan = planTriggerEdit({
    triggerPrice: Number(price),
    closesLong,
    above: row.movable!.above,
    priceIncrementX18: BigInt(product.price_increment_x18),
    marketPrice: market,
  });

  return (
    <tr>
      <td colSpan={6}>
        <div className="move-editor">
          <label className="field">
            <span>New {row.kind.toLowerCase()} price</span>
            <input type="number" min="0" step="any" value={price} onChange={(e) => onPrice(e.target.value)} autoFocus />
          </label>
          <div className="muted" style={{ maxWidth: 420 }}>
            Fires when the price is {row.movable!.above ? 'at or above' : 'at or below'}{' '}
            {formatPrice(fromX18(plan.triggerX18), product.price_increment_x18)}, then {closesLong ? 'sells' : 'buys'} {row.size}{' '}
            {product.symbol.replace('-PERP', '')} at no worse than {formatPrice(fromX18(plan.limitX18), product.price_increment_x18)}.
            {market ? ` Market now ${formatPrice(market, product.price_increment_x18)}.` : ''}
            <br />
            Two signatures: the new one is placed first, then the old one is cancelled.
          </div>
          <div className="form-row">
            <button className="btn btn-primary btn-sm" disabled={saving || plan.errors.length > 0} onClick={() => onSave(row, plan)}>
              {saving ? 'Confirm in your wallet…' : 'Move it'}
            </button>
            <button className="btn btn-secondary btn-sm" disabled={saving} onClick={onCancel}>
              Cancel
            </button>
          </div>
          {plan.errors.map((e) => (
            <div key={e} className="notice error">
              {e}
            </div>
          ))}
        </div>
      </td>
    </tr>
  );
}
