'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  cancelOrders,
  fetchOpenOrders,
  fromX18,
  isReduceOnly,
  listTriggerOrders,
  type NadoNetwork,
  type ProductSymbol,
  type SignTypedDataAsync,
  type TriggerOrderEntry,
} from '@/lib/nado';

interface Props {
  network: NadoNetwork;
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
}

const usd = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

function describeTrigger(t: TriggerOrderEntry): Pick<Row, 'kind' | 'price' | 'linkedTo'> {
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
  return {
    kind,
    price: `${above ? '≥' : '≤'} ${usd(fromX18(value))}`,
    linkedTo: t.order.trigger?.price_trigger?.dependency?.digest,
  };
}

export function MyOrders({ network, sign, sender, product, refreshKey }: Props) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);

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
          price: usd(fromX18(o.price_x18)),
          status: 'Resting on orderbook',
          service: 'gateway',
          digest: o.digest,
        };
      });
      const triggerRows: Row[] = triggers.map((t) => {
        const amount = BigInt(t.order.order.amount);
        return {
          key: t.order.digest,
          ...describeTrigger(t),
          side: amount > 0n ? 'Buy' : 'Sell',
          size: Math.abs(fromX18(amount)),
          status: t.status === 'waiting_dependency' ? 'Waiting for entry to fill' : 'Watching price',
          service: 'trigger',
          digest: t.order.digest,
        };
      });
      const planEntries = new Set(triggerRows.map((r) => r.linkedTo).filter(Boolean));
      for (const r of bookRows) if (planEntries.has(r.digest)) r.kind = 'Plan entry';
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

  async function cancel(row: Row) {
    setCancelling(row.digest);
    setError(null);
    try {
      await cancelOrders(network, sign, row.service, sender, [{ productId: product.product_id, digest: row.digest }]);
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
              {rows.map((row) => (
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
                    <button className="btn btn-secondary btn-sm" onClick={() => cancel(row)} disabled={cancelling !== null}>
                      {cancelling === row.digest ? 'Cancelling…' : row.kind === 'Plan entry' ? 'Cancel plan' : 'Cancel'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
