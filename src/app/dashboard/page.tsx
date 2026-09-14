'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAccount, useChainId, useSignTypedData } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import {
  NETWORKS,
  BUILDER_ID,
  networkForChain,
  subaccountToBytes32,
  fetchSubaccountInfo,
  fetchSymbols,
  fetchMarketPrice,
  extractPerpPosition,
  fromX18,
  type PerpPosition,
  type ProductSymbol,
  type SignTypedDataAsync,
} from '@/lib/nado';
import { TradePlanForm } from './components/TradePlanForm';
import { MyOrders } from './components/MyOrders';
import { ProtectPosition } from './components/ProtectPosition';
import { BotStatus } from './components/BotStatus';
import { Toasts, useBotStatus, useNotifications, usePush, useWalletFills } from './notifications';
import { PushSettings } from './components/PushSettings';

const MARKETS = ['BTC-PERP', 'ETH-PERP'];
const usd = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

export default function Dashboard() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { signTypedDataAsync } = useSignTypedData();
  const network = networkForChain(chainId);
  const onSupportedChain = Boolean(NETWORKS[chainId]);
  const sign = signTypedDataAsync as unknown as SignTypedDataAsync;

  const [symbols, setSymbols] = useState<Record<string, ProductSymbol>>({});
  const [market, setMarket] = useState(MARKETS[0]);
  const [exists, setExists] = useState<boolean | null>(null);
  const [usdt0, setUsdt0] = useState<number | null>(null);
  const [position, setPosition] = useState<PerpPosition | null>(null);
  const [quote, setQuote] = useState<{ bid: number; ask: number } | null>(null);
  const [ordersRefreshKey, setOrdersRefreshKey] = useState(0);

  const sender = useMemo(() => (address ? subaccountToBytes32(address, 'default') : null), [address]);
  const product = symbols[market];

  const bot = useBotStatus();
  const marketIds = useMemo(() => MARKETS.map((m) => symbols[m]?.product_id).filter((id): id is number => id !== undefined), [symbols]);
  const symbolById = useMemo(() => Object.fromEntries(Object.values(symbols).map((s) => [s.product_id, s.symbol])), [symbols]);
  const walletFills = useWalletFills(network, sender, marketIds);
  const push = usePush(sender, network.chainId);
  const { toasts, dismiss } = useNotifications(bot.status, walletFills, symbolById, push.enabled);

  useEffect(() => {
    fetchSymbols(network).then(setSymbols).catch((e) => console.error('Failed to fetch symbols', e));
  }, [network]);

  const refresh = useCallback(async () => {
    if (!product) return;
    fetchMarketPrice(network, product.product_id).then(setQuote).catch(() => setQuote(null));
    if (!sender) return;
    try {
      const info = await fetchSubaccountInfo(network, sender);
      setExists(info.exists);
      const balance = info.spot_balances.find((b: any) => b.product_id === 0);
      setUsdt0(balance ? fromX18(balance.balance.amount) : 0);
      setPosition(extractPerpPosition(info, product.product_id));
    } catch (e) {
      console.error('Failed to fetch Nado data', e);
    }
  }, [network, sender, product]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 10_000);
    return () => clearInterval(id);
  }, [refresh]);

  return (
    <main className="container" style={{ paddingTop: '2rem', paddingBottom: '4rem' }}>
      <div className="panel-header" style={{ marginBottom: '1.5rem' }}>
        <div>
          <h2>Dashboard</h2>
          <p className="muted">
            {network.label}
            {BUILDER_ID ? ` · builder #${BUILDER_ID}` : ''}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <label className="field" style={{ flexDirection: 'row', alignItems: 'center' }}>
            <span>Market</span>
            <select value={market} onChange={(e) => setMarket(e.target.value)}>
              {MARKETS.filter((m) => !Object.keys(symbols).length || symbols[m]).map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <ConnectButton />
        </div>
      </div>

      {!isConnected || !sender ? (
        <div className="glass panel" style={{ textAlign: 'center', padding: '3rem 2rem' }}>
          <h3>Connect your wallet</h3>
          <p className="muted" style={{ marginTop: '0.5rem' }}>
            Connect an EVM wallet on Ink to create trade plans that keep running on Nado while you&apos;re offline.
          </p>
          <p className="muted" style={{ marginTop: '0.75rem', fontSize: '0.85rem' }}>
            You&apos;ll only ever be asked to sign Nado order messages. Nadobot never requests token approvals, transfers or
            transactions.
          </p>
        </div>
      ) : (
        <>
          {!onSupportedChain && (
            <div className="notice error">Switch your wallet to Ink Sepolia or Ink mainnet: orders must be signed on the network they trade on.</div>
          )}
          {exists === false && (
            <div className="notice error">
              This wallet has no Nado account on {network.label} yet. Deposit at least $5 USDT0 on Nado first, then come back.
            </div>
          )}

          <div className="dashboard-grid">
            <div className="feature-card glass">
              <div className="stat-label">USDT0 balance</div>
              <div className="stat-value text-gradient">{usdt0 === null ? '…' : usd(usdt0)}</div>
              <div className="stat-sub">On Nado</div>
            </div>
            <div className="feature-card glass">
              <div className="stat-label">{market} position</div>
              <div className="stat-value" style={{ color: position ? (position.amount > 0n ? 'var(--success)' : 'var(--danger)') : undefined }}>
                {position ? `${position.amount > 0n ? 'LONG' : 'SHORT'} ${Math.abs(fromX18(position.amount))}` : 'None'}
              </div>
              <div className="stat-sub">{position ? `Avg entry ${usd(fromX18(position.avgEntryPriceX18))}` : 'No open position'}</div>
            </div>
            <div className="feature-card glass">
              <div className="stat-label">{market} price</div>
              <div className="stat-value">{quote ? usd((quote.bid + quote.ask) / 2) : '…'}</div>
              <div className="stat-sub">{quote ? `Bid ${usd(quote.bid)} · Ask ${usd(quote.ask)}` : 'Loading'}</div>
            </div>
          </div>

          {product && (
            <>
              <TradePlanForm
                network={network}
                sign={sign}
                sender={sender}
                product={product}
                bid={quote?.bid ?? null}
                ask={quote?.ask ?? null}
                onCreated={() => {
                  setOrdersRefreshKey((k) => k + 1);
                  refresh();
                }}
              />
              {position && (
                <ProtectPosition
                  network={network}
                  sign={sign}
                  sender={sender}
                  product={product}
                  position={position}
                  onPlaced={() => setOrdersRefreshKey((k) => k + 1)}
                />
              )}
              <MyOrders network={network} sign={sign} sender={sender} product={product} refreshKey={ordersRefreshKey} />
            </>
          )}
        </>
      )}

      <PushSettings
        support={push.support}
        enabled={push.enabled}
        topics={push.topics}
        busy={push.busy}
        error={push.error}
        walletConnected={Boolean(sender)}
        enable={push.enable}
        disable={push.disable}
      />
      <BotStatus status={bot.status} fills={bot.fills} error={bot.error} />
      <Toasts toasts={toasts} dismiss={dismiss} />
    </main>
  );
}
