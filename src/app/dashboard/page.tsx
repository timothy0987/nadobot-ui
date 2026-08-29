'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { useAccount, useChainId, useSignTypedData } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import {
  networkForChain,
  subaccountToBytes32,
  fetchSubaccountInfo,
  fetchOpenOrders,
  fetchSymbols,
  extractPerpPosition,
  placeTriggerOrder,
  listTriggerOrders,
  type PerpPosition,
} from '@/lib/nado';

const DEFAULT_SYMBOL = 'BTC-PERP';
const X18 = 10n ** 18n;

function formatX18(value: bigint, decimals = 2): string {
  const num = Number(value) / 1e18;
  return num.toLocaleString(undefined, { maximumFractionDigits: decimals });
}

export default function Dashboard() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { signTypedDataAsync } = useSignTypedData();
  const network = networkForChain(chainId);

  const [productId, setProductId] = useState<number | null>(null);
  const [balances, setBalances] = useState<any[]>([]);
  const [openOrders, setOpenOrders] = useState<any[]>([]);
  const [position, setPosition] = useState<PerpPosition | null>(null);
  const [triggers, setTriggers] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [stopLossPct, setStopLossPct] = useState(5);
  const [takeProfitPct, setTakeProfitPct] = useState(10);
  const [protecting, setProtecting] = useState(false);
  const [protectMessage, setProtectMessage] = useState<string | null>(null);

  const sender = useMemo(() => (address ? subaccountToBytes32(address, 'default') : null), [address]);

  // Resolve the traded product once per network.
  useEffect(() => {
    fetchSymbols(network)
      .then((symbols) => setProductId(symbols[DEFAULT_SYMBOL]?.product_id ?? null))
      .catch((e) => console.error('Failed to fetch symbols', e));
  }, [network]);

  const refresh = useCallback(async () => {
    if (!sender || productId === null) return;
    setIsLoading(true);
    try {
      const info = await fetchSubaccountInfo(network, sender);
      if (info.status === 'success') {
        setBalances(
          info.data.spot_balances.map((b: any) => ({
            productId: b.product_id,
            balance: (Number(b.balance.amount) / 1e18).toFixed(4),
          }))
        );
        setPosition(extractPerpPosition(info, productId));
      }

      const orders = await fetchOpenOrders(network, sender);
      if (orders.status === 'success') setOpenOrders(orders.data.orders || []);
    } catch (error) {
      console.error('Failed to fetch Nado data', error);
    } finally {
      setIsLoading(false);
    }
  }, [sender, productId, network]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 10000);
    return () => clearInterval(interval);
  }, [refresh]);

  // Check for active protective (reduce-only) trigger orders whenever there's an open position.
  useEffect(() => {
    if (!sender || productId === null || !position) {
      setTriggers([]);
      return;
    }
    listTriggerOrders(network, signTypedDataAsync, sender, [productId])
      .then(setTriggers)
      .catch((e) => console.error('Failed to list trigger orders', e));
  }, [sender, productId, position, network, signTypedDataAsync]);

  async function handleProtect() {
    if (!sender || productId === null || !position) return;
    setProtecting(true);
    setProtectMessage(null);
    try {
      const isLong = position.amount > 0n;
      const exitAmount = -position.amount;
      const scale = (price: bigint, mult: number) => (price * BigInt(Math.round(mult * 1_000_000))) / 1_000_000n;

      const stopPrice = isLong
        ? scale(position.avgEntryPriceX18, 1 - stopLossPct / 100)
        : scale(position.avgEntryPriceX18, 1 + stopLossPct / 100);
      const takeProfitPrice = isLong
        ? scale(position.avgEntryPriceX18, 1 + takeProfitPct / 100)
        : scale(position.avgEntryPriceX18, 1 - takeProfitPct / 100);

      await placeTriggerOrder(network, signTypedDataAsync, {
        productId,
        sender,
        priceX18: isLong ? scale(stopPrice, 0.995) : scale(stopPrice, 1.005),
        amount: exitAmount,
        reduceOnly: true,
        priceRequirement: isLong ? { last_price_below: stopPrice.toString() } : { last_price_above: stopPrice.toString() },
      });

      await placeTriggerOrder(network, signTypedDataAsync, {
        productId,
        sender,
        priceX18: isLong ? scale(takeProfitPrice, 0.995) : scale(takeProfitPrice, 1.005),
        amount: exitAmount,
        reduceOnly: true,
        priceRequirement: isLong
          ? { last_price_above: takeProfitPrice.toString() }
          : { last_price_below: takeProfitPrice.toString() },
      });

      setProtectMessage('Stop-loss and take-profit placed. They stay active on Nado even if this page is closed.');
      const updated = await listTriggerOrders(network, signTypedDataAsync, sender, [productId]);
      setTriggers(updated);
    } catch (e: any) {
      setProtectMessage(`Failed to set protection: ${e.message ?? e}`);
    } finally {
      setProtecting(false);
    }
  }

  const usdcBalance = balances.find((b) => b.productId === 0)?.balance || '0.0000';

  return (
    <main className="container" style={{ paddingTop: '2rem', paddingBottom: '4rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h2>Dashboard</h2>
          <p className="text-secondary" style={{ color: 'var(--text-secondary)' }}>
            {network.label} &middot; {DEFAULT_SYMBOL}
          </p>
        </div>
        <ConnectButton />
      </div>

      {!isConnected ? (
        <div className="glass" style={{ padding: '4rem 2rem', textAlign: 'center' }}>
          <h3>Connect your wallet</h3>
          <p style={{ color: 'var(--text-secondary)', marginTop: '0.5rem' }}>
            Connect an EVM wallet on Ink to view your Nado balances, positions, and protection status.
          </p>
        </div>
      ) : (
        <>
          <div className="dashboard-grid">
            <div className="feature-card glass">
              <div className="stat-label">USDT0 Balance</div>
              <div className="stat-value text-gradient">{isLoading && balances.length === 0 ? '...' : usdcBalance}</div>
              <div className="stat-sub">Available</div>
            </div>

            <div className="feature-card glass">
              <div className="stat-label">Open Orders</div>
              <div className="stat-value">{isLoading ? '...' : openOrders.length}</div>
              <div className="stat-sub">Active limit orders</div>
            </div>

            <div className="feature-card glass">
              <div className="stat-label">{DEFAULT_SYMBOL} Position</div>
              <div className="stat-value" style={{ color: position ? (position.amount > 0n ? 'var(--success)' : 'var(--danger)') : undefined }}>
                {position ? `${position.amount > 0n ? 'LONG' : 'SHORT'} ${formatX18(position.amount < 0n ? -position.amount : position.amount, 4)}` : 'None'}
              </div>
              <div className="stat-sub">{position ? `Avg entry $${formatX18(position.avgEntryPriceX18)}` : 'No open position'}</div>
            </div>
          </div>

          {position && (
            <div className="glass" style={{ padding: '2rem', marginTop: '0.5rem' }}>
              <h3>Position Protection</h3>
              <p style={{ color: 'var(--text-secondary)', marginTop: '0.5rem' }}>
                Attach a stop-loss and take-profit as server-side trigger orders on Nado. These live on Nado&apos;s
                infrastructure and keep the trade going even if you close this page or go offline.
              </p>

              <div style={{ marginTop: '1.5rem' }}>
                <strong>Current protection: </strong>
                {triggers.length === 0 ? (
                  <span style={{ color: 'var(--danger)' }}>Unprotected - no active stop-loss/take-profit</span>
                ) : (
                  <span style={{ color: 'var(--success)' }}>{triggers.length} active trigger order(s)</span>
                )}
              </div>

              <div style={{ display: 'flex', gap: '1.5rem', marginTop: '1.5rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <label className="field">
                  <span>Stop-loss %</span>
                  <input
                    type="number"
                    min={0.5}
                    max={50}
                    step={0.5}
                    value={stopLossPct}
                    onChange={(e) => setStopLossPct(Number(e.target.value))}
                  />
                </label>
                <label className="field">
                  <span>Take-profit %</span>
                  <input
                    type="number"
                    min={0.5}
                    max={200}
                    step={0.5}
                    value={takeProfitPct}
                    onChange={(e) => setTakeProfitPct(Number(e.target.value))}
                  />
                </label>
                <button className="btn btn-primary" onClick={handleProtect} disabled={protecting}>
                  {protecting ? 'Signing...' : 'Set Protection'}
                </button>
              </div>
              {protectMessage && <p style={{ marginTop: '1rem', color: 'var(--text-secondary)' }}>{protectMessage}</p>}
            </div>
          )}

          <div className="glass" style={{ marginTop: '2rem', overflow: 'hidden' }}>
            <div style={{ padding: '1.5rem', borderBottom: '1px solid var(--glass-border)' }}>
              <h3>Active Orders</h3>
            </div>
            <div style={{ padding: '1.5rem' }}>
              {openOrders.length === 0 ? (
                <div style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '2rem 0' }}>
                  No active orders found on Nado.
                </div>
              ) : (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Product ID</th>
                      <th>Side</th>
                      <th>Price</th>
                      <th>Type</th>
                    </tr>
                  </thead>
                  <tbody>
                    {openOrders.map((order: any, idx: number) => (
                      <tr key={idx}>
                        <td>{order.productId}</td>
                        <td style={{ color: Number(order.amount) > 0 ? 'var(--success)' : 'var(--danger)' }}>
                          {Number(order.amount) > 0 ? 'Long' : 'Short'}
                        </td>
                        <td>{order.priceX18}</td>
                        <td>Limit</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </>
      )}
    </main>
  );
}
