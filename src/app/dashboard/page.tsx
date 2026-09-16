'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAccount, useSignTypedData } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import {
  BUILDER_ID,
  INK_MAINNET,
  subaccountToBytes32,
  fetchSubaccountInfo,
  fetchSymbols,
  fetchMarketPrice,
  extractPerpPosition,
  formatPrice,
  fromX18,
  liquidationPrice,
  parseAccountRisk,
  type AccountRisk,
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
import { TwapForm } from './components/TwapForm';
import { LadderForm } from './components/LadderForm';
import { PortfolioPanel } from './components/PortfolioPanel';
import { PriceAlerts } from './components/PriceAlerts';
import { MainnetGate, NetworkSwitch, useDashboardNetwork } from './components/NetworkSwitch';
import { MarketPicker, tradableMarkets } from './components/MarketPicker';

const DEFAULT_MARKET = 'BTC-PERP';
const MARKET_KEY = 'nadobot:market';
const usd = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

export default function Dashboard() {
  const { address, isConnected } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const { network, onSupportedChain, select, switching, switchError } = useDashboardNetwork();
  const isMainnet = network.chainId === INK_MAINNET.chainId;
  const sign = signTypedDataAsync as unknown as SignTypedDataAsync;

  const [symbols, setSymbols] = useState<Record<string, ProductSymbol>>({});
  const [market, setMarket] = useState(DEFAULT_MARKET);
  const [account, setAccount] = useState<AccountRisk | null>(null);
  const [exists, setExists] = useState<boolean | null>(null);
  const [usdt0, setUsdt0] = useState<number | null>(null);
  const [position, setPosition] = useState<PerpPosition | null>(null);
  const [quote, setQuote] = useState<{ bid: number; ask: number } | null>(null);
  const [ordersRefreshKey, setOrdersRefreshKey] = useState(0);

  const sender = useMemo(() => (address ? subaccountToBytes32(address, 'default') : null), [address]);
  const markets = useMemo(() => tradableMarkets(symbols), [symbols]);
  const product = markets.find((m) => m.symbol === market);

  // Notifications open /dashboard?market=SYMBOL (price alerts) or also &renew=DIGEST (a finished DCA). Otherwise fall back
  // to the last market used here. The link is cleared afterwards so a reload doesn't repeat it.
  const [renewDigest, setRenewDigest] = useState<string | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fromLink = params.get('market');
    const renew = params.get('renew');
    if (fromLink || renew) window.history.replaceState(null, '', window.location.pathname);
    if (renew && /^0x[0-9a-fA-F]{64}$/.test(renew)) setRenewDigest(renew);
    if (fromLink) {
      setMarket(fromLink.toUpperCase());
      try {
        localStorage.setItem(MARKET_KEY, fromLink.toUpperCase());
      } catch {}
      return;
    }
    try {
      const saved = localStorage.getItem(MARKET_KEY);
      if (saved) setMarket(saved);
    } catch {}
  }, []);
  useEffect(() => {
    if (markets.length && !markets.some((m) => m.symbol === market)) setMarket(DEFAULT_MARKET);
  }, [markets, market]);
  const chooseMarket = (symbol: string) => {
    setMarket(symbol);
    try {
      localStorage.setItem(MARKET_KEY, symbol);
    } catch {}
  };

  const bot = useBotStatus();
  const marketIds = useMemo(() => markets.map((m) => m.product_id), [markets]);
  const symbolById = useMemo(() => Object.fromEntries(Object.values(symbols).map((s) => [s.product_id, s.symbol])), [symbols]);
  const walletFills = useWalletFills(network, sender, marketIds);
  const push = usePush(sender, network.chainId);
  const { toasts, dismiss } = useNotifications(bot.status, walletFills, symbolById, push.enabled);

  // Never show one network's balances under the other while the new data loads.
  useEffect(() => {
    setSymbols({});
    setQuote(null);
    setExists(null);
    setUsdt0(null);
    setPosition(null);
    setAccount(null);
    fetchSymbols(network).then(setSymbols).catch((e) => console.error('Failed to fetch symbols', e));
  }, [network, sender]);

  // A new market must never be priced with the previous market's quote, even for one render, and a response for the
  // previous market that arrives late must be dropped.
  const currentProductId = useRef<number | undefined>(undefined);
  useEffect(() => {
    currentProductId.current = product?.product_id;
    setQuote(null);
    setPosition(null);
  }, [product?.product_id]);

  const refresh = useCallback(async () => {
    if (!product) return;
    const productId = product.product_id;
    const stillCurrent = () => currentProductId.current === productId;
    fetchMarketPrice(network, productId)
      .then((q) => stillCurrent() && setQuote(q))
      .catch(() => stillCurrent() && setQuote(null));
    if (!sender) return;
    try {
      const info = await fetchSubaccountInfo(network, sender);
      setExists(info.exists);
      const balance = info.spot_balances.find((b: any) => b.product_id === 0);
      setUsdt0(balance ? fromX18(balance.balance.amount) : 0);
      if (stillCurrent()) setPosition(extractPerpPosition(info, productId));
      setAccount(parseAccountRisk(info));
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
          <NetworkSwitch network={network} select={select} switching={switching} />
          <MarketPicker markets={markets} value={market} onChange={chooseMarket} />
          <ConnectButton />
        </div>
      </div>

      {switchError && <div className="notice error">{switchError}</div>}

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
            <div className="notice error">
              Your wallet is on a network Nado doesn't use. Pick Testnet or Mainnet above: orders must be signed on the network they trade on.
            </div>
          )}
          {onSupportedChain && exists === false && (
            <div className="notice error">
              This wallet has no Nado account on {network.label} yet. Deposit at least $5 USDT0{' '}
              {isMainnet ? (
                <a href="https://app.nado.xyz" target="_blank" rel="noreferrer" style={{ textDecoration: 'underline' }}>on app.nado.xyz</a>
              ) : (
                <a href="https://testnet.nado.xyz/portfolio/faucet" target="_blank" rel="noreferrer" style={{ textDecoration: 'underline' }}>from Nado's testnet faucet</a>
              )}
              , then come back.
            </div>
          )}

          <div className="dashboard-grid">
            <div className="feature-card glass">
              <div className="stat-label">Account value</div>
              <div className="stat-value text-gradient">{account ? usd(account.equity) : usdt0 === null ? '…' : usd(usdt0)}</div>
              <div className="stat-sub">
                {account
                  ? `Margin available ${usd(Math.max(account.availableMargin, 0))} · USDT0 ${usd(usdt0 ?? 0)}`
                  : 'On Nado'}
              </div>
            </div>
            <div className="feature-card glass">
              <div className="stat-label">{market} position</div>
              <div className="stat-value" style={{ color: position ? (position.amount > 0n ? 'var(--success)' : 'var(--danger)') : undefined }}>
                {position ? `${position.amount > 0n ? 'LONG' : 'SHORT'} ${Math.abs(fromX18(position.amount))}` : 'None'}
              </div>
              <div className="stat-sub">
                {position && product
                  ? `Avg entry ${formatPrice(fromX18(position.avgEntryPriceX18), product.price_increment_x18)}${
                      account && liquidationPrice(account, product.product_id) !== null
                        ? ` · Liq. ~${formatPrice(liquidationPrice(account, product.product_id)!, product.price_increment_x18)}`
                        : ''
                    }`
                  : 'No open position'}
              </div>
            </div>
            <div className="feature-card glass">
              <div className="stat-label">{market} price</div>
              <div className="stat-value">{quote && product ? formatPrice((quote.bid + quote.ask) / 2, product.price_increment_x18) : '…'}</div>
              <div className="stat-sub">
                {quote && product
                  ? `Bid ${formatPrice(quote.bid, product.price_increment_x18)} · Ask ${formatPrice(quote.ask, product.price_increment_x18)}`
                  : 'Loading'}
              </div>
            </div>
          </div>

          {onSupportedChain && exists !== false && <PortfolioPanel
              network={network}
              sign={sign}
              sender={sender}
              symbols={symbols}
              onClosed={() => {
                setOrdersRefreshKey((k) => k + 1);
                refresh();
              }}
            />}

          {product && onSupportedChain && (
            <MainnetGate network={network}>
              <TradePlanForm
                key={`plan-${product.product_id}`}
                account={account}
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
              <LadderForm
                key={`ladder-${product.product_id}`}
                account={account}
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
              <TwapForm
                key={`twap-${product.product_id}`}
                account={account}
                network={network}
                sign={sign}
                sender={sender}
                product={product}
                bid={quote?.bid ?? null}
                ask={quote?.ask ?? null}
                pushEndpoint={push.endpoint}
                renewDigest={renewDigest}
              />
              {position && (
                <ProtectPosition
                  key={`protect-${product.product_id}`}
                  account={account}
                  network={network}
                  sign={sign}
                  sender={sender}
                  product={product}
                  position={position}
                  onPlaced={() => setOrdersRefreshKey((k) => k + 1)}
                />
              )}
              <MyOrders
                network={network}
                bid={quote?.bid ?? null}
                ask={quote?.ask ?? null}
                sign={sign}
                sender={sender}
                product={product}
                refreshKey={ordersRefreshKey}
              />
            </MainnetGate>
          )}
        </>
      )}

      <PriceAlerts
        network={network}
        product={product}
        bid={quote?.bid ?? null}
        ask={quote?.ask ?? null}
        endpoint={push.endpoint}
        pushEnabled={push.enabled}
      />
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
