export interface NadoNetwork {
  chainId: number;
  label: string;
  gatewayUrl: string;
  triggerUrl: string;
  archiveUrl: string;
  explorerUrl: string;
}

export const INK_SEPOLIA: NadoNetwork = {
  chainId: 763373,
  label: 'Ink Sepolia (Testnet)',
  gatewayUrl: 'https://gateway.test.nado.xyz/v1',
  triggerUrl: 'https://trigger.test.nado.xyz/v1',
  archiveUrl: 'https://archive.test.nado.xyz/v1',
  explorerUrl: 'https://explorer-sepolia.inkonchain.com',
};

export const INK_MAINNET: NadoNetwork = {
  chainId: 57073,
  label: 'Ink Mainnet',
  gatewayUrl: 'https://gateway.prod.nado.xyz/v1',
  triggerUrl: 'https://trigger.prod.nado.xyz/v1',
  archiveUrl: 'https://archive.prod.nado.xyz/v1',
  explorerUrl: 'https://explorer.inkonchain.com',
};

export const NETWORKS: Record<number, NadoNetwork> = {
  [INK_SEPOLIA.chainId]: INK_SEPOLIA,
  [INK_MAINNET.chainId]: INK_MAINNET,
};

export function networkForChain(chainId: number | undefined): NadoNetwork {
  return (chainId && NETWORKS[chainId]) || INK_SEPOLIA;
}

// Builder code: every order the dashboard signs carries these, so the builder earns a fee.
// A non-zero fee rate without a registered builder id is rejected by Nado, so both default to 0.
export const BUILDER_ID = Number(process.env.NEXT_PUBLIC_BUILDER_ID ?? 0);
export const BUILDER_FEE_RATE_TENTH_BPS = BUILDER_ID ? Number(process.env.NEXT_PUBLIC_BUILDER_FEE_RATE_TENTH_BPS ?? 0) : 0;

const X18 = 10n ** 18n;
const gatewayHeaders = { 'Content-Type': 'application/json', 'Accept-Encoding': 'gzip, br, deflate' };

export type SignTypedDataAsync = (args: {
  domain: any;
  types: any;
  primaryType: string;
  message: any;
}) => Promise<`0x${string}`>;

/* ---------------------------------- encoding ---------------------------------- */

/**
 * Nado subaccounts = 20-byte wallet address + 12-byte name. The name is the ASCII
 * text of the name (e.g. "default"), right-padded with zero bytes - NOT all-zero bytes.
 */
export function subaccountToBytes32(address: `0x${string}`, name = 'default'): `0x${string}` {
  const nameHex = Array.from(new TextEncoder().encode(name))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .padEnd(24, '0');
  return (address.toLowerCase() + nameHex) as `0x${string}`;
}

export function verifyingContractForProduct(productId: number): `0x${string}` {
  return `0x${productId.toString(16).padStart(40, '0')}` as `0x${string}`;
}

function nadoDomain(network: NadoNetwork, verifyingContract: `0x${string}`) {
  return { name: 'Nado', version: '0.0.1', chainId: network.chainId, verifyingContract } as const;
}

const ORDER_TYPES = {
  Order: [
    { name: 'sender', type: 'bytes32' },
    { name: 'priceX18', type: 'int128' },
    { name: 'amount', type: 'int128' },
    { name: 'expiration', type: 'uint64' },
    { name: 'nonce', type: 'uint64' },
    { name: 'appendix', type: 'uint128' },
  ],
} as const;

const CANCELLATION_TYPES = {
  Cancellation: [
    { name: 'sender', type: 'bytes32' },
    { name: 'productIds', type: 'uint32[]' },
    { name: 'digests', type: 'bytes32[]' },
    { name: 'nonce', type: 'uint64' },
  ],
} as const;

const LIST_TRIGGER_ORDERS_TYPES = {
  ListTriggerOrders: [
    { name: 'sender', type: 'bytes32' },
    { name: 'recvTime', type: 'uint64' },
  ],
} as const;

export const OrderType = { DEFAULT: 0, IOC: 1, FOK: 2, POST_ONLY: 3 } as const;
const TRIGGER_PRICE = 1;
const TRIGGER_TWAP = 2;
const TRIGGER_TWAP_CUSTOM_AMOUNTS = 3;
const REDUCE_ONLY_BIT = 1n << 11n;

/** Order appendix bit layout per docs.nado.xyz (version, order type, reduce-only, trigger type, builder, value). */
export function encodeAppendix(opts: { reduceOnly?: boolean; orderType?: number; triggerType?: number; value?: bigint } = {}): bigint {
  const { reduceOnly = false, orderType = 0, triggerType = 0, value = 0n } = opts;
  let appendix = 1n;
  appendix |= BigInt(orderType) << 9n;
  appendix |= (reduceOnly ? 1n : 0n) << 11n;
  appendix |= BigInt(triggerType) << 12n;
  appendix |= BigInt(BUILDER_FEE_RATE_TENTH_BPS) << 38n;
  appendix |= BigInt(BUILDER_ID) << 48n;
  appendix |= value << 64n;
  return appendix;
}

export const isReduceOnly = (appendix: string) => (BigInt(appendix) & REDUCE_ONLY_BIT) !== 0n;

export function buildNonce(discardAfterMs = 60_000): bigint {
  const recvTime = BigInt(Date.now() + discardAfterMs);
  const random = BigInt(Math.floor(Math.random() * (1 << 20)));
  return (recvTime << 20n) + random;
}

export type RoundMode = 'down' | 'up' | 'nearest';

/** Nado rejects any price/size that isn't an exact multiple of the product's increment. */
export function roundToIncrement(value: bigint, increment: bigint, mode: RoundMode): bigint {
  if (increment <= 0n) return value;
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const remainder = abs % increment;
  let rounded = abs - remainder;
  if (remainder !== 0n) {
    const awayFromZero = mode === 'nearest' ? remainder * 2n >= increment : (mode === 'up') !== negative;
    if (awayFromZero) rounded += increment;
  }
  return negative ? -rounded : rounded;
}

/** Decimal number (e.g. a price typed by the user) to x18 without float drift beyond 1e-9. */
export const toX18 = (value: number) => BigInt(Math.round(value * 1e9)) * 10n ** 9n;
export const fromX18 = (value: bigint | string) => Number(BigInt(value)) / 1e18;

/** Decimal places in a market's price tick or lot size (x18), e.g. 0.01 -> 2, 1 -> 0. */
export function incrementDecimals(incrementX18: bigint | string): number {
  let increment = BigInt(incrementX18);
  if (increment <= 0n) return 2;
  let decimals = 18;
  while (decimals > 0 && increment % 10n === 0n) {
    increment /= 10n;
    decimals--;
  }
  return decimals;
}

/**
 * A USD price with the precision its market trades at (BTC to the dollar, small caps to six decimals). Without a
 * tick, precision follows the size of the number so sub-dollar prices never round to $0.
 */
export function formatPrice(value: number, priceIncrementX18?: bigint | string): string {
  const abs = Math.abs(value);
  const decimals = priceIncrementX18 !== undefined ? incrementDecimals(priceIncrementX18) : abs >= 1000 ? 2 : abs >= 1 ? 4 : 6;
  return `${value < 0 ? '-' : ''}$${abs.toLocaleString('en-US', { maximumFractionDigits: decimals })}`;
}

/** A price as an input value (no grouping), at the market's tick precision. */
export const priceInputValue = (value: number, priceIncrementX18: bigint | string) => value.toFixed(incrementDecimals(priceIncrementX18));

/* ---------------------------------- queries ---------------------------------- */

async function gatewayQuery(network: NadoNetwork, body: object) {
  const res = await fetch(`${network.gatewayUrl}/query`, { method: 'POST', headers: gatewayHeaders, body: JSON.stringify(body) });
  const json = await res.json();
  if (json.status !== 'success') throw new Error(json.error ?? `Query failed (${res.status})`);
  return json.data;
}

export const fetchSubaccountInfo = (network: NadoNetwork, sender: string) =>
  gatewayQuery(network, { type: 'subaccount_info', subaccount: sender });

/** Unlike subaccount_info, this query takes `sender` (not `subaccount`) and requires a product_id. */
export const fetchOpenOrders = (network: NadoNetwork, sender: string, productId: number) =>
  gatewayQuery(network, { type: 'subaccount_orders', sender, product_id: productId });

export interface ProductSymbol {
  type: string;
  product_id: number;
  symbol: string;
  trading_status: string;
  price_increment_x18: string;
  size_increment: string;
  min_size: string;
}

export async function fetchSymbols(network: NadoNetwork) {
  const data = await gatewayQuery(network, { type: 'symbols' });
  return data.symbols as Record<string, ProductSymbol>;
}

export async function fetchMarketPrice(network: NadoNetwork, productId: number) {
  const data = await gatewayQuery(network, { type: 'market_price', product_id: productId });
  return { bid: fromX18(data.bid_x18), ask: fromX18(data.ask_x18) };
}

const endpointAddrCache: Record<number, `0x${string}`> = {};

/** Every execute except place_order is signed against the Nado endpoint contract, not address(productId). */
async function fetchEndpointAddress(network: NadoNetwork): Promise<`0x${string}`> {
  if (!endpointAddrCache[network.chainId]) {
    const data = await gatewayQuery(network, { type: 'contracts' });
    endpointAddrCache[network.chainId] = data.endpoint_addr;
  }
  return endpointAddrCache[network.chainId];
}

export interface PerpPosition {
  productId: number;
  amount: bigint;
  avgEntryPriceX18: bigint;
}

export function extractPerpPosition(subaccountInfo: any, productId: number): PerpPosition | null {
  const balance = subaccountInfo?.perp_balances?.find((b: any) => b.product_id === productId);
  if (!balance) return null;
  const amount = BigInt(balance.balance.amount);
  if (amount === 0n) return null;
  const vQuote = BigInt(balance.balance.v_quote_balance);
  return { productId, amount, avgEntryPriceX18: (-vQuote * X18) / amount };
}

export interface Match {
  digest: string;
  productId: number;
  submissionIdx: string;
  timestamp: number;
  baseFilled: number;
  quoteFilled: number;
  /** Fees excluded from realizedPnl; negative fees are maker rebates. */
  fee: number;
  realizedPnl: number;
  builderFee: number;
  isTaker: boolean;
  /** Builder code carried by the filled order (0 when none), read from its appendix. */
  builderId: number;
}

async function archiveQuery(network: NadoNetwork, body: object) {
  const res = await fetch(network.archiveUrl, { method: 'POST', headers: gatewayHeaders, body: JSON.stringify(body) });
  const json = await res.json();
  if (json.error) throw new Error(json.error);
  return json;
}

function parseMatches(json: any): Match[] {
  const txs = new Map<string, any>((json.txs ?? []).map((t: any) => [String(t.submission_idx), t]));
  return (json.matches ?? []).map((m: any) => {
    const tx = txs.get(String(m.submission_idx));
    return {
      digest: m.digest,
      productId: Number(m.pre_balance?.base?.perp?.product_id ?? m.pre_balance?.base?.spot?.product_id ?? tx?.tx?.match_orders?.product_id ?? -1),
      submissionIdx: String(m.submission_idx),
      timestamp: Number(tx?.timestamp ?? 0),
      baseFilled: fromX18(m.base_filled),
      quoteFilled: fromX18(m.quote_filled),
      fee: fromX18(m.fee),
      realizedPnl: fromX18(m.realized_pnl ?? '0'),
      builderFee: fromX18(m.builder_fee ?? '0'),
      isTaker: Boolean(m.is_taker),
      builderId: m.order?.appendix ? Number((BigInt(m.order.appendix) >> 48n) & 0xffffn) : 0,
    };
  });
}

/** Recent fills for a subaccount from Nado's archive indexer. Public data, no signature needed. */
export async function fetchMatches(network: NadoNetwork, subaccount: string, productIds: number[], limit = 20): Promise<Match[]> {
  return parseMatches(await archiveQuery(network, { matches: { subaccounts: [subaccount], product_ids: productIds, limit } }));
}

/* ---------------------------------- executes ---------------------------------- */

async function signOrder(network: NadoNetwork, sign: SignTypedDataAsync, productId: number, order: any) {
  return sign({ domain: nadoDomain(network, verifyingContractForProduct(productId)), types: ORDER_TYPES, primaryType: 'Order', message: order });
}

function serializeOrder(order: any) {
  return {
    sender: order.sender,
    priceX18: order.priceX18.toString(),
    amount: order.amount.toString(),
    expiration: order.expiration.toString(),
    nonce: order.nonce.toString(),
    appendix: order.appendix.toString(),
  };
}

async function execute(url: string, body: object) {
  const res = await fetch(`${url}/execute`, { method: 'POST', headers: gatewayHeaders, body: JSON.stringify(body) });
  const json = await res.json();
  if (json.status !== 'success') throw new Error(`${json.error ?? 'Rejected'}${json.error_code ? ` (${json.error_code})` : ''}`);
  return json;
}

/** Places a regular order on the orderbook, signed by the connected wallet. Returns its digest. */
export async function placeOrder(
  network: NadoNetwork,
  sign: SignTypedDataAsync,
  p: { productId: number; sender: `0x${string}`; priceX18: bigint; amount: bigint; orderType?: number; reduceOnly?: boolean; expiresInSeconds?: number }
): Promise<string> {
  const order = {
    sender: p.sender,
    priceX18: p.priceX18,
    amount: p.amount,
    expiration: BigInt(Math.floor(Date.now() / 1000) + (p.expiresInSeconds ?? 60 * 60 * 24 * 7)),
    nonce: buildNonce(),
    appendix: encodeAppendix({ orderType: p.orderType ?? OrderType.DEFAULT, reduceOnly: p.reduceOnly }),
  };
  const signature = await signOrder(network, sign, p.productId, order);
  const json = await execute(network.gatewayUrl, { place_order: { product_id: p.productId, order: serializeOrder(order), signature } });
  return json.data.digest;
}

export type PriceRequirement =
  | { oracle_price_above: string }
  | { oracle_price_below: string }
  | { last_price_above: string }
  | { last_price_below: string };

/**
 * Places a conditional order on Nado's trigger service, signed by the connected wallet. It lives on Nado's
 * servers and fires whether or not this page is open. With `dependsOn`, it stays dormant until that order fills.
 */
export async function placeTriggerOrder(
  network: NadoNetwork,
  sign: SignTypedDataAsync,
  p: {
    productId: number;
    sender: `0x${string}`;
    priceX18: bigint;
    amount: bigint;
    priceRequirement: PriceRequirement;
    reduceOnly?: boolean;
    dependsOn?: string;
    expiresInSeconds?: number;
  }
): Promise<string> {
  const order = {
    sender: p.sender,
    priceX18: p.priceX18,
    amount: p.amount,
    expiration: BigInt(Math.floor(Date.now() / 1000) + (p.expiresInSeconds ?? 60 * 60 * 24 * 30)),
    nonce: buildNonce(),
    appendix: encodeAppendix({ reduceOnly: p.reduceOnly ?? true, orderType: OrderType.IOC, triggerType: TRIGGER_PRICE }),
  };
  const signature = await signOrder(network, sign, p.productId, order);
  const priceTrigger: any = { price_requirement: p.priceRequirement };
  // Activate protection on the first partial fill: reduce-only caps it at whatever size actually filled.
  if (p.dependsOn) priceTrigger.dependency = { digest: p.dependsOn, on_partial_fill: true };
  const json = await execute(network.triggerUrl, {
    place_order: { product_id: p.productId, order: serializeOrder(order), signature, trigger: { price_trigger: priceTrigger } },
  });
  return json.data.digest;
}

export interface TriggerOrderEntry {
  order: {
    order: { sender: string; priceX18: string; amount: string; expiration: string; nonce: string; appendix: string };
    product_id: number;
    trigger: any;
    digest: string;
  };
  /** A string like 'waiting_price', or an object for a running TWAP: {twap_executing: {current_execution, total_executions}}. */
  status: unknown;
  placed_at: number;
  updated_at: number;
}

/** Pending conditional orders for a subaccount. Needs one wallet signature, so only call it on user action. */
export async function listTriggerOrders(network: NadoNetwork, sign: SignTypedDataAsync, sender: `0x${string}`, productIds?: number[]) {
  const recvTime = BigInt(Date.now() + 60_000);
  const signature = await sign({
    domain: nadoDomain(network, await fetchEndpointAddress(network)),
    types: LIST_TRIGGER_ORDERS_TYPES,
    primaryType: 'ListTriggerOrders',
    message: { sender, recvTime },
  });
  const res = await fetch(`${network.triggerUrl}/query`, {
    method: 'POST',
    headers: gatewayHeaders,
    body: JSON.stringify({
      type: 'list_trigger_orders',
      tx: { sender, recvTime: recvTime.toString() },
      signature,
      ...(productIds ? { product_ids: productIds } : {}),
      status_types: ['waiting_price', 'waiting_dependency', 'twap_executing'],
    }),
  });
  const json = await res.json();
  if (json.status !== 'success') throw new Error(json.error ?? 'Could not list trigger orders');
  // The docs' field table shows `orders` at the top level, but the live service nests it under `data`.
  return (json.data?.orders ?? []) as TriggerOrderEntry[];
}

/** Cancels orders by digest. `service` picks the orderbook (gateway) or the trigger service. */
export async function cancelOrders(
  network: NadoNetwork,
  sign: SignTypedDataAsync,
  service: 'gateway' | 'trigger',
  sender: `0x${string}`,
  orders: { productId: number; digest: string }[]
) {
  if (orders.length === 0) return;
  const tx = { sender, productIds: orders.map((o) => o.productId), digests: orders.map((o) => o.digest), nonce: buildNonce() };
  const signature = await sign({
    domain: nadoDomain(network, await fetchEndpointAddress(network)),
    types: CANCELLATION_TYPES,
    primaryType: 'Cancellation',
    message: tx,
  });
  await execute(service === 'gateway' ? network.gatewayUrl : network.triggerUrl, {
    cancel_orders: { tx: { ...tx, nonce: tx.nonce.toString() }, signature },
  });
}

/* ---------------------------------- trade plans ---------------------------------- */

export interface TradePlanInput {
  productId: number;
  sender: `0x${string}`;
  side: 'long' | 'short';
  size: number;
  entryPrice: number;
  stopLossPercent: number;
  takeProfitPercent: number;
  expiresInDays: number;
  priceIncrementX18: bigint;
  sizeIncrementX18: bigint;
}

export interface TradePlanPrices {
  amount: bigint;
  entryX18: bigint;
  stopX18: bigint;
  takeProfitX18: bigint;
  stopLimitX18: bigint;
  takeProfitLimitX18: bigint;
}

const EXIT_SLIPPAGE = 0.005;

/** Pure: turns a plan into tick-aligned prices and a lot-aligned size. */
export function priceTradePlan(p: TradePlanInput): TradePlanPrices {
  const isLong = p.side === 'long';
  const tick = (v: number, mode: RoundMode) => roundToIncrement(toX18(v), p.priceIncrementX18, mode);
  const lots = roundToIncrement(toX18(p.size), p.sizeIncrementX18, 'down');
  const stop = p.entryPrice * (isLong ? 1 - p.stopLossPercent / 100 : 1 + p.stopLossPercent / 100);
  const takeProfit = p.entryPrice * (isLong ? 1 + p.takeProfitPercent / 100 : 1 - p.takeProfitPercent / 100);
  const worse = isLong ? 1 - EXIT_SLIPPAGE : 1 + EXIT_SLIPPAGE;
  const exitMode: RoundMode = isLong ? 'down' : 'up';
  return {
    amount: isLong ? lots : -lots,
    // A long entry is a buy: round down so it never pays more than asked. A short entry rounds up.
    entryX18: tick(p.entryPrice, isLong ? 'down' : 'up'),
    stopX18: tick(stop, 'nearest'),
    takeProfitX18: tick(takeProfit, 'nearest'),
    stopLimitX18: tick(stop * worse, exitMode),
    takeProfitLimitX18: tick(takeProfit * worse, exitMode),
  };
}

/**
 * Creates a no-custody trade plan: a resting limit entry on the orderbook plus a stop-loss and take-profit that
 * stay dormant until the entry fills. All three are signed by the trader's own wallet and live on Nado's servers,
 * so the plan runs while they are offline and no one else ever holds their key.
 */
export async function createTradePlan(network: NadoNetwork, sign: SignTypedDataAsync, p: TradePlanInput) {
  const prices = priceTradePlan(p);
  if (prices.amount === 0n) throw new Error('Size is below the minimum lot size for this market');
  const isLong = p.side === 'long';
  const expiresInSeconds = Math.round(p.expiresInDays * 86400);

  const entryDigest = await placeOrder(network, sign, {
    productId: p.productId,
    sender: p.sender,
    priceX18: prices.entryX18,
    amount: prices.amount,
    orderType: OrderType.DEFAULT,
    expiresInSeconds,
  });

  const exitAmount = -prices.amount;
  const stopDigest = await placeTriggerOrder(network, sign, {
    productId: p.productId,
    sender: p.sender,
    priceX18: prices.stopLimitX18,
    amount: exitAmount,
    priceRequirement: isLong ? { last_price_below: prices.stopX18.toString() } : { last_price_above: prices.stopX18.toString() },
    dependsOn: entryDigest,
    expiresInSeconds: expiresInSeconds + 60 * 60 * 24 * 30,
  });
  const takeProfitDigest = await placeTriggerOrder(network, sign, {
    productId: p.productId,
    sender: p.sender,
    priceX18: prices.takeProfitLimitX18,
    amount: exitAmount,
    priceRequirement: isLong
      ? { last_price_above: prices.takeProfitX18.toString() }
      : { last_price_below: prices.takeProfitX18.toString() },
    dependsOn: entryDigest,
    expiresInSeconds: expiresInSeconds + 60 * 60 * 24 * 30,
  });

  return { entryDigest, stopDigest, takeProfitDigest, prices };
}

/* ---------------------------------- bot status ---------------------------------- */

// Public, read-only endpoint of the always-on bot on Railway. Override per deployment with the env var.
export const BOT_STATUS_URL = process.env.NEXT_PUBLIC_BOT_STATUS_URL ?? 'https://nadobot-production.up.railway.app';

export interface BotEvent {
  id: number;
  at: string;
  level: 'info' | 'warn' | 'error';
  message: string;
  count: number;
}

export interface BotStatus {
  network: string;
  botAddress: string;
  subaccount: string;
  product: string;
  strategy: {
    dipBuyEnabled: boolean;
    entryDropPercent: number;
    tradeAmount: number;
    maxPositionSize: number;
    tradingPaused?: boolean;
    dailyLossLimitUsd?: number;
    protectionEnabled: boolean;
    stopLossPercent: number;
    takeProfitPercent: number;
  };
  startedAt: string;
  sessionHigh: number;
  lastPrice: number;
  entryTriggerPrice: number | null;
  lastBuyAt: string | null;
  lastSkippedBuyReason: string | null;
  lastProtectionCheckAt: string | null;
  position: { amount: number; avgEntryPrice: number } | null;
  protection: { stopPrice: number; takeProfitPrice: number; size: number; digests: string[] } | null;
  lastError: { at: string; message: string } | null;
  events?: BotEvent[];
  risk?: { dailyNetPnl: number | null; checkedAt: string | null; buyBlockedReason: string | null };
}

export async function fetchBotStatus(): Promise<BotStatus> {
  // While Railway swaps containers on a redeploy, requests can hang; fail fast so the panel says "Not responding".
  const res = await fetch(`${BOT_STATUS_URL.replace(/\/$/, '')}/status`, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Bot status endpoint returned ${res.status}`);
  return res.json();
}

/* ---------------------------------- TWAP / DCA ---------------------------------- */

// Limits enforced by Nado's trigger service (per the official SDK): 1-500 executions, the whole schedule must fit
// within 25 hours, and every execution is an IOC order that must meet the market's minimum order size.
export const TWAP_MAX_EXECUTIONS = 500;
export const TWAP_MAX_DURATION_SECONDS = 25 * 60 * 60;

/** Value field of a TWAP appendix: executions in the high 32 bits, max slippage x 1e6 in the low 32 bits. */
export function encodeTwapValue(times: number, slippageFrac: number): bigint {
  return (BigInt(times) << 32n) | BigInt(Math.round(slippageFrac * 1_000_000));
}

export interface TwapInput {
  productId: number;
  sender: `0x${string}`;
  side: 'buy' | 'sell';
  totalSize: number;
  executions: number;
  intervalSeconds: number;
  slippagePercent: number;
  /** Buys never execute above this price, sells never below. */
  limitPrice: number;
  /** Current market price, used to check each execution clears the minimum order value at today's price. */
  marketPrice?: number;
  reduceOnly?: boolean;
  priceIncrementX18: bigint;
  sizeIncrementX18: bigint;
  minOrderValueX18: bigint;
}

export interface TwapPlan {
  amount: bigint;
  sliceAmounts: bigint[];
  limitPriceX18: bigint;
  durationSeconds: number;
  expiration: bigint;
  appendixValue: bigint;
  errors: string[];
}

/**
 * Pure: turns a TWAP request into exact on-chain amounts and checks it against Nado's limits. Every slice is an exact
 * lot multiple, with any rounding remainder added to the last slice so the total is what the trader asked for.
 */
export function planTwap(p: TwapInput, nowSeconds: number): TwapPlan {
  const errors: string[] = [];
  const executions = Math.floor(p.executions);
  if (!(executions >= 1 && executions <= TWAP_MAX_EXECUTIONS)) errors.push(`Executions must be between 1 and ${TWAP_MAX_EXECUTIONS}.`);
  if (!(p.intervalSeconds >= 1)) errors.push('Interval must be at least 1 second.');
  if (!(p.slippagePercent > 0 && p.slippagePercent <= 10)) errors.push('Max slippage must be between 0 and 10%.');
  if (!(p.limitPrice > 0)) errors.push('Enter a limit price.');

  const total = roundToIncrement(toX18(p.totalSize), p.sizeIncrementX18, 'down');
  const n = BigInt(Math.max(executions, 1));
  const baseSlice = roundToIncrement(total / n, p.sizeIncrementX18, 'down');
  const sliceAmounts = Array.from({ length: Number(n) }, (_, i) => (i === Number(n) - 1 ? total - baseSlice * (n - 1n) : baseSlice));
  if (total === 0n || baseSlice === 0n) {
    errors.push("Each execution is smaller than the market's minimum lot size. Increase the size or use fewer executions.");
  }

  const limitPriceX18 = roundToIncrement(toX18(p.limitPrice), p.priceIncrementX18, p.side === 'buy' ? 'down' : 'up');
  // A buy fills below its limit, so value each slice at the lower of the limit and today's price.
  const valuationPriceX18 =
    p.marketPrice && p.marketPrice > 0 && toX18(p.marketPrice) < limitPriceX18 ? toX18(p.marketPrice) : limitPriceX18;
  const smallestSliceValue = (baseSlice * valuationPriceX18) / 10n ** 18n;
  if (baseSlice > 0n && smallestSliceValue < p.minOrderValueX18) {
    errors.push(
      `Each execution is worth about $${fromX18(smallestSliceValue).toFixed(2)}, below this market's $${fromX18(p.minOrderValueX18)} minimum. ` +
        `Use at least ~$${Math.ceil(fromX18(p.minOrderValueX18) * executions * 1.02).toLocaleString('en-US')} in total, or fewer executions.`
    );
  }

  const durationSeconds = (executions - 1) * p.intervalSeconds;
  if (durationSeconds > TWAP_MAX_DURATION_SECONDS) {
    errors.push(`Nado limits a TWAP to 25 hours; this schedule runs ${(durationSeconds / 3600).toFixed(1)} hours. Use fewer executions or a shorter interval.`);
  }
  // Nado requires now + duration <= expiration <= now + 25h. Leave an hour of slack for late executions.
  const expiration = BigInt(nowSeconds + Math.min(durationSeconds + 3600, TWAP_MAX_DURATION_SECONDS));

  if (p.marketPrice && p.limitPrice > 0) {
    if (p.side === 'buy' && p.limitPrice < p.marketPrice) errors.push('Your max price is below the current price, so the buys would not fill.');
    if (p.side === 'sell' && p.limitPrice > p.marketPrice) errors.push('Your min price is above the current price, so the sells would not fill.');
  }

  const sign = p.side === 'buy' ? 1n : -1n;
  return {
    amount: total * sign,
    sliceAmounts: sliceAmounts.map((a) => a * sign),
    limitPriceX18,
    durationSeconds,
    expiration,
    appendixValue: encodeTwapValue(executions, p.slippagePercent / 100),
    errors,
  };
}

/** Places a TWAP on Nado's trigger service with one wallet signature. Nado runs every execution on its own servers. */
export async function placeTwapOrder(network: NadoNetwork, sign: SignTypedDataAsync, p: TwapInput): Promise<{ digest: string; plan: TwapPlan }> {
  const plan = planTwap(p, Math.floor(Date.now() / 1000));
  if (plan.errors.length) throw new Error(plan.errors[0]);

  // Custom amounts only when rounding left the last slice different; Nado then executes exactly these sizes.
  const unevenSlices = plan.sliceAmounts.some((a) => a !== plan.sliceAmounts[0]);
  const order = {
    sender: p.sender,
    priceX18: plan.limitPriceX18,
    amount: plan.amount,
    expiration: plan.expiration,
    nonce: buildNonce(),
    appendix: encodeAppendix({
      orderType: OrderType.IOC,
      reduceOnly: p.reduceOnly,
      triggerType: unevenSlices ? TRIGGER_TWAP_CUSTOM_AMOUNTS : TRIGGER_TWAP,
      value: plan.appendixValue,
    }),
  };
  const signature = await signOrder(network, sign, p.productId, order);
  const timeTrigger: { interval: number; amounts?: string[] } = { interval: p.intervalSeconds };
  if (unevenSlices) timeTrigger.amounts = plan.sliceAmounts.map(String);
  const json = await execute(network.triggerUrl, {
    place_order: { product_id: p.productId, order: serializeOrder(order), signature, trigger: { time_trigger: timeTrigger } },
  });
  return { digest: json.data.digest, plan };
}

export type TwapExecutionState = 'pending' | 'executed' | 'failed' | 'cancelled';

export interface TwapExecution {
  id: number;
  scheduledTime: number;
  state: TwapExecutionState;
  detail: string | null;
}

/** Progress of one TWAP. Public data keyed by the order digest, so no signature is needed. */
export async function fetchTwapExecutions(network: NadoNetwork, digest: string): Promise<TwapExecution[]> {
  const res = await fetch(`${network.triggerUrl}/query`, {
    method: 'POST',
    headers: gatewayHeaders,
    body: JSON.stringify({ type: 'list_twap_executions', digest }),
  });
  const json = await res.json();
  if (json.status !== 'success') throw new Error(json.error ?? 'Could not load TWAP progress');
  return (json.data?.executions ?? []).map((e: any) => {
    const status = e.status;
    const state: TwapExecutionState =
      typeof status === 'string' ? 'pending' : status.executed ? 'executed' : status.failed !== undefined ? 'failed' : 'cancelled';
    const detail = typeof status === 'string' ? null : (status.failed ?? status.cancelled ?? null);
    return { id: e.execution_id, scheduledTime: e.scheduled_time, state, detail };
  });
}

/** Reads a TWAP's schedule back out of a pending trigger order, for listing it. */
export function describeTwap(entry: TriggerOrderEntry) {
  const value = BigInt(entry.order.order.appendix) >> 64n;
  return {
    executions: Number(value >> 32n),
    slippagePercent: Number(value & 0xffffffffn) / 10_000,
    intervalSeconds: Number(entry.order.trigger?.time_trigger?.interval ?? 0),
  };
}

/* ---------------------------------- ladders ---------------------------------- */

export const LADDER_MAX_RUNGS = 10;
export const LADDER_MAX_TAKE_PROFITS = 4;

export interface LadderTakeProfit {
  /** Distance from the average entry price. */
  percent: number;
  /** Share of the full ladder size this target closes. Shares add up to 100. */
  sharePercent: number;
}

export interface LadderInput {
  productId: number;
  sender: `0x${string}`;
  side: 'long' | 'short';
  totalSize: number;
  rungs: number;
  /** Rung closest to the market, which fills first. */
  nearPrice: number;
  /** Rung furthest from the market. */
  farPrice: number;
  /** 'even' puts the same size on every rung; 'weighted' puts more size on better prices (1x near to Nx far). */
  distribution: 'even' | 'weighted';
  /** Distance from the average entry price. */
  stopLossPercent: number;
  takeProfits: LadderTakeProfit[];
  expiresInDays: number;
  bid?: number | null;
  ask?: number | null;
  priceIncrementX18: bigint;
  sizeIncrementX18: bigint;
  minOrderValueX18: bigint;
}

export interface LadderExit {
  triggerX18: bigint;
  limitX18: bigint;
  amount: bigint;
}

export interface LadderPlan {
  rungs: { priceX18: bigint; amount: bigint }[];
  amount: bigint;
  averageEntry: number;
  stop: LadderExit;
  takeProfits: (LadderExit & LadderTakeProfit)[];
  /** Wallet signatures needed to place the whole ladder. */
  signatures: number;
  errors: string[];
}

const usdText = (n: number) => `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
const valueOf = (amount: bigint, priceX18: bigint) => fromX18(((amount < 0n ? -amount : amount) * priceX18) / X18);

/** Splits `totalLots` by weight in whole lots; the rounding remainder goes to the last part so nothing is lost. */
function splitLots(totalLots: bigint, weights: number[]): bigint[] {
  const scaled = weights.map((w) => BigInt(Math.round(w * 10_000)));
  const sum = scaled.reduce((a, b) => a + b, 0n);
  if (sum === 0n) return weights.map(() => 0n);
  const parts = scaled.map((w) => (totalLots * w) / sum);
  parts[parts.length - 1] += totalLots - parts.reduce((a, b) => a + b, 0n);
  return parts;
}

/**
 * Pure: turns a ladder request into tick- and lot-aligned orders and checks it behaves as intended: every rung rests
 * instead of filling instantly, the stop sits beyond the last rung, every target sits beyond the first rung, and every
 * order clears the market minimum (the trigger service only enforces that when an exit fires, so it is checked here).
 */
export function planLadder(p: LadderInput): LadderPlan {
  const errors: string[] = [];
  const isLong = p.side === 'long';
  const dir = isLong ? 1 : -1;
  const n = Math.floor(p.rungs);
  if (!(n >= 1 && n <= LADDER_MAX_RUNGS)) errors.push(`Use between 1 and ${LADDER_MAX_RUNGS} rungs.`);
  const rungCount = Math.min(Math.max(n || 1, 1), LADDER_MAX_RUNGS);
  if (!(p.nearPrice > 0)) errors.push('Enter the price of the first rung.');
  if (rungCount > 1) {
    if (!(p.farPrice > 0)) errors.push('Enter the price of the last rung.');
    else if (isLong ? p.farPrice >= p.nearPrice : p.farPrice <= p.nearPrice)
      errors.push(isLong ? 'For a long ladder, the last rung must be below the first.' : 'For a short ladder, the last rung must be above the first.');
  }
  if (!(p.stopLossPercent > 0 && p.stopLossPercent < 50)) errors.push('Stop-loss must be between 0 and 50%.');
  const tps = p.takeProfits;
  if (!(tps.length >= 1 && tps.length <= LADDER_MAX_TAKE_PROFITS)) errors.push(`Use between 1 and ${LADDER_MAX_TAKE_PROFITS} take-profit targets.`);
  if (tps.some((t) => !(t.percent > 0) || !(t.sharePercent > 0))) errors.push('Every take-profit needs a distance and a share above 0.');
  else if (tps.some((t, i) => i > 0 && t.percent <= tps[i - 1].percent)) errors.push('Each take-profit must be further away than the one before it.');
  const shareTotal = tps.reduce((a, t) => a + (t.sharePercent || 0), 0);
  if (Math.abs(shareTotal - 100) > 0.01) errors.push(`Take-profit shares add up to ${Number(shareTotal.toFixed(2))}%; they must add up to 100%.`);

  const lot = p.sizeIncrementX18;
  const totalLots = lot > 0n ? roundToIncrement(toX18(Math.max(p.totalSize || 0, 0)), lot, 'down') / lot : 0n;
  if (totalLots === 0n) errors.push("Size is below this market's minimum lot size.");

  // Prices step evenly from the first rung to the last. Buys round down and sells round up, so neither pays worse.
  const tickMode: RoundMode = isLong ? 'down' : 'up';
  const nearPrice = p.nearPrice > 0 ? p.nearPrice : 0;
  const farPrice = rungCount > 1 && p.farPrice > 0 ? p.farPrice : nearPrice;
  const prices = Array.from({ length: rungCount }, (_, i) =>
    roundToIncrement(toX18(rungCount > 1 ? nearPrice + ((farPrice - nearPrice) * i) / (rungCount - 1) : nearPrice), p.priceIncrementX18, tickMode)
  );
  if (nearPrice > 0 && prices.some((px, i) => i > 0 && px === prices[i - 1])) errors.push("Rungs are closer together than this market's price tick. Widen the range or use fewer rungs.");

  const weights = Array.from({ length: rungCount }, (_, i) => (p.distribution === 'weighted' ? i + 1 : 1));
  const rungLots = splitLots(totalLots, weights);
  const sign = BigInt(dir);
  const rungs = prices.map((priceX18, i) => ({ priceX18, amount: rungLots[i] * lot * sign }));
  const amount = totalLots * lot * sign;
  const min = fromX18(p.minOrderValueX18);

  if (totalLots > 0n && rungLots.some((l) => l === 0n)) {
    errors.push("Some rungs are smaller than this market's minimum lot size. Increase the size or use fewer rungs.");
  } else if (totalLots > 0n && nearPrice > 0) {
    const values = rungs.map((r) => valueOf(r.amount, r.priceX18));
    const smallest = Math.min(...values);
    if (smallest < min) {
      const needed = Math.ceil(values.reduce((a, b) => a + b, 0) * (min / smallest) * 1.02);
      errors.push(`The smallest rung is worth about ${usdText(smallest)}, below this market's ${usdText(min)} minimum. Use at least ~${usdText(needed)} in total, or fewer rungs.`);
    }
  }

  // A rung on the wrong side of the market would fill immediately as a taker order instead of waiting for the price.
  const near = fromX18(prices[0]);
  if (near > 0 && isLong && p.ask && near >= p.ask) errors.push(`The first rung (${formatPrice(near, p.priceIncrementX18)}) is at or above the ask (${formatPrice(p.ask, p.priceIncrementX18)}), so it would fill immediately. Start the ladder below the market.`);
  if (near > 0 && !isLong && p.bid && near <= p.bid) errors.push(`The first rung (${formatPrice(near, p.priceIncrementX18)}) is at or below the bid (${formatPrice(p.bid, p.priceIncrementX18)}), so it would fill immediately. Start the ladder above the market.`);

  const averageEntry = totalLots > 0n ? rungs.reduce((a, r) => a + valueOf(r.amount, r.priceX18), 0) / Math.abs(fromX18(amount)) : near;
  const worse = isLong ? 1 - EXIT_SLIPPAGE : 1 + EXIT_SLIPPAGE;
  const exitMode: RoundMode = isLong ? 'down' : 'up';
  const tick = (v: number, mode: RoundMode) => roundToIncrement(toX18(v), p.priceIncrementX18, mode);

  const stopPrice = averageEntry * (1 - (dir * p.stopLossPercent) / 100);
  const stop: LadderExit = { triggerX18: tick(stopPrice, 'nearest'), limitX18: tick(stopPrice * worse, exitMode), amount: -amount };
  const last = fromX18(prices[prices.length - 1]);
  if (near > 0 && p.stopLossPercent > 0 && (isLong ? fromX18(stop.triggerX18) >= last : fromX18(stop.triggerX18) <= last)) {
    errors.push(
      `The stop-loss (${formatPrice(fromX18(stop.triggerX18), p.priceIncrementX18)}) is ${isLong ? 'at or above' : 'at or below'} your last rung (${formatPrice(last, p.priceIncrementX18)}), so it could close the position before the ladder fills. Widen the stop-loss or narrow the ladder.`
    );
  }

  const tpLots = splitLots(totalLots, tps.map((t) => (t.sharePercent > 0 ? t.sharePercent : 0)));
  const takeProfits = tps.map((t, i) => {
    const price = averageEntry * (1 + (dir * t.percent) / 100);
    return { ...t, triggerX18: tick(price, 'nearest'), limitX18: tick(price * worse, exitMode), amount: -tpLots[i] * lot * sign };
  });
  if (near > 0) {
    takeProfits.forEach((t, i) => {
      if (!(t.percent > 0) || !(t.sharePercent > 0)) return;
      const trigger = fromX18(t.triggerX18);
      if (isLong ? trigger <= near : trigger >= near) {
        errors.push(`Take-profit ${i + 1} (${formatPrice(trigger, p.priceIncrementX18)}) is ${isLong ? 'at or below' : 'at or above'} your first rung (${formatPrice(near, p.priceIncrementX18)}), so it could close at a loss. Move it further out.`);
      } else if (totalLots > 0n && valueOf(t.amount, t.triggerX18) < min) {
        errors.push(`Take-profit ${i + 1} closes only about ${usdText(valueOf(t.amount, t.triggerX18))}, below this market's ${usdText(min)} minimum, so it would fail when it fires. Give it a bigger share or use fewer targets.`);
      }
    });
  }

  return { rungs, amount, averageEntry, stop, takeProfits, signatures: rungCount + 1 + tps.length, errors };
}

export interface PlacedOrder {
  service: 'gateway' | 'trigger';
  digest: string;
  role: 'rung' | 'stop' | 'take-profit';
}

/** Thrown when an order fails partway through a ladder: `placed` lists what is already live so it can be rolled back. */
export class LadderPlacementError extends Error {
  constructor(
    message: string,
    readonly placed: PlacedOrder[]
  ) {
    super(message);
  }
}

/**
 * Places a ladder: the first rung, then the stop-loss and take-profits (dormant until that rung fills, which happens
 * before any deeper rung because the price reaches it first), then the remaining rungs. Exits are reduce-only and sized
 * for the full ladder, so they never close more than has actually filled.
 */
export async function placeLadder(
  network: NadoNetwork,
  sign: SignTypedDataAsync,
  p: LadderInput,
  onProgress?: (signed: number, total: number) => void
): Promise<{ plan: LadderPlan; placed: PlacedOrder[] }> {
  const plan = planLadder(p);
  if (plan.errors.length) throw new Error(plan.errors[0]);
  const isLong = p.side === 'long';
  const expiresInSeconds = Math.round(p.expiresInDays * 86400);
  const exitExpiry = expiresInSeconds + 60 * 60 * 24 * 30;
  const placed: PlacedOrder[] = [];

  const step = async (role: PlacedOrder['role'], service: PlacedOrder['service'], place: () => Promise<string>) => {
    onProgress?.(placed.length, plan.signatures);
    try {
      placed.push({ role, service, digest: await place() });
    } catch (e: any) {
      throw new LadderPlacementError(e.shortMessage ?? e.message, [...placed]);
    }
  };
  const rung = (i: number) => () =>
    placeOrder(network, sign, { productId: p.productId, sender: p.sender, priceX18: plan.rungs[i].priceX18, amount: plan.rungs[i].amount, expiresInSeconds });
  const exit = (e: LadderExit, priceRequirement: PriceRequirement, dependsOn: string) => () =>
    placeTriggerOrder(network, sign, { productId: p.productId, sender: p.sender, priceX18: e.limitX18, amount: e.amount, priceRequirement, dependsOn, expiresInSeconds: exitExpiry });

  await step('rung', 'gateway', rung(0));
  const firstRung = placed[0].digest;
  const stopAt = plan.stop.triggerX18.toString();
  await step('stop', 'trigger', exit(plan.stop, isLong ? { last_price_below: stopAt } : { last_price_above: stopAt }, firstRung));
  for (const tp of plan.takeProfits) {
    const at = tp.triggerX18.toString();
    await step('take-profit', 'trigger', exit(tp, isLong ? { last_price_above: at } : { last_price_below: at }, firstRung));
  }
  for (let i = 1; i < plan.rungs.length; i++) await step('rung', 'gateway', rung(i));
  onProgress?.(placed.length, plan.signatures);
  return { plan, placed };
}

const sameDigest = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Digests of a ladder's rungs still resting on the orderbook. Public data, so no signature. */
export async function openLadderRungs(network: NadoNetwork, sender: `0x${string}`, productId: number, orders: PlacedOrder[]) {
  const book: { digest: string }[] = (await fetchOpenOrders(network, sender, productId)).orders ?? [];
  return orders.filter((o) => o.service === 'gateway' && book.some((b) => sameDigest(b.digest, o.digest)));
}

/**
 * Cancels a ladder's unfilled rungs and, with `includeExits`, its stop-loss and take-profits. Nado rejects a whole
 * cancel batch if any digest is already gone, so only orders that are still open are sent. Rungs go first: if the
 * trader rejects the next signature, the exits keep protecting whatever already filled.
 */
export async function cancelLadder(
  network: NadoNetwork,
  sign: SignTypedDataAsync,
  sender: `0x${string}`,
  productId: number,
  orders: PlacedOrder[],
  includeExits: boolean
) {
  const rungs = await openLadderRungs(network, sender, productId, orders);
  await cancelOrders(network, sign, 'gateway', sender, rungs.map((o) => ({ productId, digest: o.digest })));
  const exits = orders.filter((o) => o.service === 'trigger');
  if (!includeExits || exits.length === 0) return;
  // Exits waiting on a cancelled first rung may be removed with it, so re-read what is still pending.
  if (rungs.length) await new Promise((r) => setTimeout(r, 2000));
  const pending = await listTriggerOrders(network, sign, sender, [productId]);
  const live = exits.filter((o) => pending.some((t) => sameDigest(t.order.digest, o.digest)));
  await cancelOrders(network, sign, 'trigger', sender, live.map((o) => ({ productId, digest: o.digest })));
}

/* ---------------------------------- portfolio ---------------------------------- */

/** One position window from Nado's indexer: from the fill that opened it to the one that closed (or last changed) it. */
export interface PositionRecord {
  productId: number;
  isolated: boolean;
  long: boolean;
  open: boolean;
  openId: string;
  /** Current absolute size; 0 once closed. */
  size: number;
  maxSize: number;
  entryPrice: number;
  exitPrice: number;
  /** Open plus close fees; negative means net rebates. */
  fees: number;
  /** Price PnL on size already closed, fees and funding excluded. */
  realizedPnl: number;
  /** Funding received (positive) or paid (negative). */
  funding: number;
  liquidatedSize: number;
  openedAt: number;
  updatedAt: number;
}

function parsePosition(p: any): PositionRecord {
  return {
    productId: Number(p.product_id),
    isolated: Boolean(p.isolated),
    long: Boolean(p.direction),
    open: String(p.close_id) === '-1',
    openId: String(p.open_id),
    size: fromX18(p.amount),
    maxSize: fromX18(p.max_amount),
    entryPrice: fromX18(p.average_entry_price),
    exitPrice: fromX18(p.average_exit_price),
    fees: fromX18(p.open_fee) + fromX18(p.close_fee),
    realizedPnl: fromX18(p.realized_pnl),
    funding: fromX18(p.net_funding_payment),
    liquidatedSize: fromX18(p.liquidated_amount),
    openedAt: Number(p.open_timestamp),
    updatedAt: Number(p.update_timestamp),
  };
}

/** Net result of a position so far: realized price PnL minus fees plus funding. */
export const positionNetPnl = (p: PositionRecord) => p.realizedPnl - p.fees + p.funding;

/** Position history, newest first. Pass `nextIdx` back as `idx` for the next page. Public data, no signature. */
export async function fetchPositions(network: NadoNetwork, subaccount: string, opts: { open?: boolean; limit?: number; idx?: string } = {}) {
  const limit = opts.limit ?? 50;
  const json = await archiveQuery(network, {
    positions: { subaccount, limit, ...(opts.open === undefined ? {} : { open: opts.open }), ...(opts.idx ? { idx: opts.idx } : {}) },
  });
  const positions: PositionRecord[] = (json.positions ?? []).map(parsePosition);
  const oldest = positions.reduce<bigint | null>((min, p) => (min === null || BigInt(p.openId) < min ? BigInt(p.openId) : min), null);
  return { positions, nextIdx: positions.length === limit && oldest !== null ? (oldest - 1n).toString() : null };
}

/** Every fill since `sinceSeconds`, newest first, paging 500 at a time. `truncated` when `maxPages` ran out first. */
export async function fetchFillsSince(network: NadoNetwork, subaccount: string, sinceSeconds: number, maxPages = 4) {
  const fills: Match[] = [];
  let idx: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const batch = parseMatches(await archiveQuery(network, { matches: { subaccounts: [subaccount], limit: 500, ...(idx ? { idx } : {}) } }));
    for (const f of batch) {
      if (f.timestamp < sinceSeconds) return { fills, truncated: false };
      fills.push(f);
    }
    if (batch.length < 500) return { fills, truncated: false };
    idx = (BigInt(batch[batch.length - 1].submissionIdx) - 1n).toString();
  }
  return { fills, truncated: true };
}

/** Lifetime traded volume (USDT0) and fill count per market, from each market's latest fill event. */
export async function fetchLifetimeVolume(network: NadoNetwork, subaccount: string, productIds: number[]) {
  const results = await Promise.all(
    productIds.map(async (productId) => {
      const json = await archiveQuery(network, { events: { subaccounts: [subaccount], product_ids: [productId], event_types: ['match_orders'], limit: { raw: 1 } } });
      const e = json.events?.[0];
      return { productId, volume: e ? fromX18(e.quote_volume_cumulative ?? '0') : 0, trades: e ? Number(e.cumulative_trade_count ?? 0) : 0 };
    })
  );
  return {
    volume: results.reduce((a, r) => a + r.volume, 0),
    trades: results.reduce((a, r) => a + r.trades, 0),
    byProduct: results,
  };
}

/** Oracle (mark) price per product id, the price Nado values positions at. */
export async function fetchOraclePrices(network: NadoNetwork): Promise<Record<number, number>> {
  const data = await gatewayQuery(network, { type: 'all_products' });
  const prices: Record<number, number> = {};
  for (const p of [...(data.spot_products ?? []), ...(data.perp_products ?? [])]) prices[p.product_id] = fromX18(p.oracle_price_x18);
  return prices;
}

export interface OpenPositionView {
  productId: number;
  long: boolean;
  size: number;
  /** Exact signed position size as Nado holds it, for building a closing order. */
  amountX18: bigint;
  entryPrice: number;
  markPrice: number;
  value: number;
  /** Price PnL at the mark, before fees and funding. */
  unrealizedPnl: number;
  unrealizedPercent: number;
  funding: number;
  fees: number;
}

/**
 * Pure: live positions from the gateway (authoritative size) joined with the indexer's record (entry price, fees,
 * funding). If the indexer hasn't caught up with a fresh fill yet, the entry falls back to the gateway's cost basis.
 */
export function buildOpenPositions(subaccountInfo: any, records: PositionRecord[], marks: Record<number, number>): OpenPositionView[] {
  const views: OpenPositionView[] = [];
  for (const b of subaccountInfo?.perp_balances ?? []) {
    const amount = BigInt(b.balance.amount);
    if (amount === 0n) continue;
    const productId = Number(b.product_id);
    const long = amount > 0n;
    const size = Math.abs(fromX18(amount));
    const record = records.find((r) => r.open && !r.isolated && r.productId === productId && r.long === long);
    const entryPrice = record?.entryPrice || Math.abs(fromX18((-BigInt(b.balance.v_quote_balance) * X18) / amount));
    const markPrice = marks[productId] ?? entryPrice;
    const unrealizedPnl = (markPrice - entryPrice) * size * (long ? 1 : -1);
    views.push({
      productId,
      long,
      size,
      amountX18: amount,
      entryPrice,
      markPrice,
      value: size * markPrice,
      unrealizedPnl,
      unrealizedPercent: entryPrice ? (unrealizedPnl / (entryPrice * size)) * 100 : 0,
      funding: record?.funding ?? 0,
      fees: record?.fees ?? 0,
    });
  }
  return views.sort((a, b) => b.value - a.value);
}

export interface PnlBucket {
  /** Unix seconds at the start of the bucket (UTC-aligned). */
  start: number;
  volume: number;
  /** Realized price PnL minus fees for fills in the bucket. */
  pnl: number;
}

export interface TradingSummary {
  volume: number;
  fills: number;
  makerVolume: number;
  fees: number;
  realizedPnl: number;
  /** Realized PnL minus fees. Funding is not part of fills; it is reported per position. */
  netPnl: number;
  builderVolume: number;
  buckets: PnlBucket[];
}

/** Pure: totals plus one bucket per `bucketSeconds` (empty ones included) for fills in [sinceSeconds, nowSeconds]. */
export function summarizeFills(fills: Match[], sinceSeconds: number, nowSeconds: number, builderId = 0, bucketSeconds = 86400): TradingSummary {
  const align = (t: number) => Math.floor(t / bucketSeconds) * bucketSeconds;
  const buckets = new Map<number, PnlBucket>();
  for (let t = align(sinceSeconds); t <= nowSeconds; t += bucketSeconds) buckets.set(t, { start: t, volume: 0, pnl: 0 });
  const summary: TradingSummary = { volume: 0, fills: 0, makerVolume: 0, fees: 0, realizedPnl: 0, netPnl: 0, builderVolume: 0, buckets: [] };
  for (const f of fills) {
    if (f.timestamp < sinceSeconds || f.timestamp > nowSeconds) continue;
    const notional = Math.abs(f.quoteFilled);
    summary.volume += notional;
    summary.fills += 1;
    if (!f.isTaker) summary.makerVolume += notional;
    summary.fees += f.fee;
    summary.realizedPnl += f.realizedPnl;
    if (builderId && f.builderId === builderId) summary.builderVolume += notional;
    const bucket = buckets.get(align(f.timestamp));
    if (bucket) {
      bucket.volume += notional;
      bucket.pnl += f.realizedPnl - f.fee;
    }
  }
  summary.netPnl = summary.realizedPnl - summary.fees;
  summary.buckets = [...buckets.values()].sort((a, b) => a.start - b.start);
  return summary;
}

/* ---------------------------------- account risk ---------------------------------- */

export interface RiskWeights {
  /** Price Nado values the position at (the oracle price). */
  price: number;
  longInitial: number;
  shortInitial: number;
  longMaintenance: number;
  shortMaintenance: number;
}

export interface AccountRisk {
  /** Account value: Nado's unweighted health (collateral plus unrealized PnL). */
  equity: number;
  /** Initial health: margin left for new positions. Nado rejects trades that would take it below 0. */
  availableMargin: number;
  /** Maintenance health: the account can be liquidated once this falls below 0. */
  maintenanceMargin: number;
  perps: Record<number, { amount: number; vQuote: number }>;
  weights: Record<number, RiskWeights>;
}

/** Pure: reads health, positions and risk weights out of a subaccount_info response. Null if the account doesn't exist. */
export function parseAccountRisk(info: any): AccountRisk | null {
  if (!info?.exists || !Array.isArray(info.healths) || info.healths.length < 3) return null;
  const weights: AccountRisk['weights'] = {};
  for (const p of info.perp_products ?? []) {
    weights[p.product_id] = {
      price: fromX18(p.risk?.price_x18 ?? p.oracle_price_x18),
      longInitial: fromX18(p.risk.long_weight_initial_x18),
      shortInitial: fromX18(p.risk.short_weight_initial_x18),
      longMaintenance: fromX18(p.risk.long_weight_maintenance_x18),
      shortMaintenance: fromX18(p.risk.short_weight_maintenance_x18),
    };
  }
  const perps: AccountRisk['perps'] = {};
  for (const b of info.perp_balances ?? []) {
    perps[b.product_id] = { amount: fromX18(b.balance.amount), vQuote: fromX18(b.balance.v_quote_balance) };
  }
  return {
    availableMargin: fromX18(info.healths[0].health),
    maintenanceMargin: fromX18(info.healths[1].health),
    equity: fromX18(info.healths[2].health),
    perps,
    weights,
  };
}

/** Highest leverage Nado allows on a market, from its initial long weight (0.95 -> 20x). */
export const maxLeverage = (w: RiskWeights) => (w.longInitial < 1 ? 1 / (1 - w.longInitial) : 1);

// A perp's contribution to each health: amount x price x weight + v_quote, the weight picked by the position's side.
// Checked against Nado's own health_contributions and its apply_delta simulation.
function perpContribution(amount: number, vQuote: number, w: RiskWeights) {
  const long = amount >= 0;
  return {
    initial: amount * w.price * (long ? w.longInitial : w.shortInitial) + vQuote,
    maintenance: amount * w.price * (long ? w.longMaintenance : w.shortMaintenance) + vQuote,
    unweighted: amount * w.price + vQuote,
  };
}

export interface ProjectedFill {
  productId: number;
  /** Signed base amount: positive buys, negative sells. */
  amount: number;
  price: number;
}

/** Pure: the account as it would be if these fills happened (before fees), the same way Nado's health engine counts them. */
export function projectRisk(account: AccountRisk, fills: ProjectedFill[]): AccountRisk {
  const next: AccountRisk = { ...account, perps: { ...account.perps } };
  for (const f of fills) {
    const w = account.weights[f.productId];
    if (!w || !f.amount) continue;
    const before = next.perps[f.productId] ?? { amount: 0, vQuote: 0 };
    const after = { amount: before.amount + f.amount, vQuote: before.vQuote - f.amount * f.price };
    const b = perpContribution(before.amount, before.vQuote, w);
    const a = perpContribution(after.amount, after.vQuote, w);
    next.availableMargin += a.initial - b.initial;
    next.maintenanceMargin += a.maintenance - b.maintenance;
    next.equity += a.unweighted - b.unweighted;
    next.perps[f.productId] = after;
  }
  return next;
}

/** Pure: the account valued with one market's price moved to `price`, everything else unchanged. */
export function repriceAccount(account: AccountRisk, productId: number, price: number): AccountRisk {
  const w = account.weights[productId];
  if (!w || !(price > 0)) return account;
  const moved = { ...w, price };
  const next: AccountRisk = { ...account, weights: { ...account.weights, [productId]: moved } };
  const pos = account.perps[productId];
  if (pos && pos.amount) {
    const b = perpContribution(pos.amount, pos.vQuote, w);
    const a = perpContribution(pos.amount, pos.vQuote, moved);
    next.availableMargin += a.initial - b.initial;
    next.maintenanceMargin += a.maintenance - b.maintenance;
    next.equity += a.unweighted - b.unweighted;
  }
  return next;
}

/**
 * Estimated mark price at which the account could be liquidated, moving only this market's price. Maintenance health
 * changes by amount x maintenance weight per $1 of price, so it reaches 0 at price - health / (amount x weight).
 * Null when there is no position, or a long that stays solvent all the way to $0.
 */
export function liquidationPrice(account: AccountRisk, productId: number): number | null {
  const pos = account.perps[productId];
  const w = account.weights[productId];
  if (!pos || !w || Math.abs(pos.amount) < 1e-12) return null;
  const slope = pos.amount * (pos.amount > 0 ? w.longMaintenance : w.shortMaintenance);
  const price = w.price - account.maintenanceMargin / slope;
  if (account.maintenanceMargin <= 0) return w.price;
  return price > 0 ? price : null;
}

/** Total perp exposure divided by account value. */
export function accountLeverage(account: AccountRisk) {
  const exposure = Object.entries(account.perps).reduce(
    (sum, [id, p]) => sum + Math.abs(p.amount * (account.weights[Number(id)]?.price ?? 0)),
    0
  );
  return account.equity > 0 ? exposure / account.equity : exposure > 0 ? Infinity : 0;
}

export interface TradeRisk {
  after: AccountRisk;
  leverage: number;
  liquidationPrice: number | null;
  /** Share of account value tied up as initial margin after the trade. */
  marginUsedPercent: number;
  errors: string[];
  warnings: string[];
}

/**
 * Pure: what a trade does to the account if it fully fills. Errors mean Nado would reject it (not enough margin) or the
 * stop-loss sits past the liquidation price, so the account could be liquidated before the stop fires.
 */
export function assessTradeRisk(
  account: AccountRisk,
  trade: { productId: number; fills: ProjectedFill[]; stopPrice?: number; priceIncrementX18?: bigint | string }
): TradeRisk {
  // Limit orders fill only once the market reaches them, so judge margin at the last fill price rather than today's
  // price. The liquidation price is the same either way; margin and leverage are what this makes realistic.
  const fillMark = trade.fills.length ? trade.fills[trade.fills.length - 1].price : undefined;
  const atFill = fillMark ? repriceAccount(account, trade.productId, fillMark) : account;
  const after = projectRisk(atFill, trade.fills);
  const errors: string[] = [];
  const warnings: string[] = [];
  const fmt = (n: number) => formatPrice(n, trade.priceIncrementX18);
  const money = (n: number) => `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;

  if (after.availableMargin < 0) {
    errors.push(
      `Not enough margin: fully filled, this needs about ${money(-after.availableMargin)} more than your account would have available (${money(Math.max(atFill.availableMargin, 0))}). Reduce the size or deposit more on Nado.`
    );
  }

  const liq = liquidationPrice(after, trade.productId);
  const pos = after.perps[trade.productId];
  const long = (pos?.amount ?? 0) > 0;
  if (liq !== null && trade.stopPrice && trade.stopPrice > 0 && !errors.length) {
    if (long ? trade.stopPrice <= liq : trade.stopPrice >= liq) {
      errors.push(
        `Your stop-loss (${fmt(trade.stopPrice)}) is ${long ? 'at or below' : 'at or above'} the estimated liquidation price (${fmt(liq)}), so you could be liquidated before it fires. Tighten the stop-loss or reduce the size.`
      );
    }
  }

  const mark = account.weights[trade.productId]?.price ?? 0;
  if (liq !== null && mark > 0 && !errors.length) {
    const distance = Math.abs(mark - liq) / mark;
    if (distance < 0.1) warnings.push(`Liquidation would be only ${(distance * 100).toFixed(1)}% from the current price.`);
  }
  const leverage = accountLeverage(after);
  if (leverage >= 10 && !errors.length) warnings.push(`Account leverage would be ${leverage.toFixed(1)}x. Small price moves will have a large effect.`);

  return {
    after,
    leverage,
    liquidationPrice: liq,
    marginUsedPercent: after.equity > 0 ? Math.min(Math.max(((after.equity - after.availableMargin) / after.equity) * 100, 0), 100) : 100,
    errors,
    warnings,
  };
}

/** Base size that loses `riskUsd` if price moves from `entry` to `stop` (before fees), rounded down to the lot size. */
export function sizeForRisk(riskUsd: number, entry: number, stop: number, sizeIncrementX18: bigint | string): number {
  const perUnit = Math.abs(entry - stop);
  if (!(riskUsd > 0) || !(perUnit > 0)) return 0;
  return fromX18(roundToIncrement(toX18(riskUsd / perUnit), BigInt(sizeIncrementX18), 'down'));
}

/* ---------------------------------- closing a position ---------------------------------- */

/** How far past the touch a close is allowed to fill. It is an IOC order, so this is a cap, not a target. */
export const CLOSE_SLIPPAGE_PERCENT = 1;

export interface ClosePlan {
  /** Signed amount of the closing order: negative closes a long, positive closes a short. */
  amount: bigint;
  limitPriceX18: bigint;
  /** Value of the closing order at the touch price. */
  notional: number;
  /** Share of the position this closes, after rounding to whole lots. */
  fractionClosed: number;
  errors: string[];
}

/**
 * Pure: turns "close 25% of this position" into an immediate-or-cancel reduce-only order. Closing a long sells into the
 * bid, closing a short buys from the ask, each with a slippage cap so a thin book can't fill it at any price.
 */
export function planClose(p: {
  positionAmount: bigint;
  /** 0 to 1; 1 closes the exact position size, leaving nothing behind. */
  fraction: number;
  bid: number | null;
  ask: number | null;
  slippagePercent?: number;
  priceIncrementX18: bigint;
  sizeIncrementX18: bigint;
  minOrderValueX18: bigint;
}): ClosePlan {
  const errors: string[] = [];
  const isLong = p.positionAmount > 0n;
  const touch = isLong ? p.bid : p.ask;
  const slippage = (p.slippagePercent ?? CLOSE_SLIPPAGE_PERCENT) / 100;

  const size = p.positionAmount < 0n ? -p.positionAmount : p.positionAmount;
  const fraction = Math.min(Math.max(p.fraction, 0), 1);
  // A full close sends the exact position size; a partial close rounds down to whole lots.
  const closing =
    fraction >= 1 ? size : roundToIncrement((size * BigInt(Math.round(fraction * 10_000))) / 10_000n, p.sizeIncrementX18, 'down');
  const amount = isLong ? -closing : closing;

  if (size === 0n) errors.push('There is no position to close.');
  else if (closing === 0n) errors.push("That share of the position is smaller than this market's minimum lot size. Close a larger share.");

  const limitPriceX18 = touch
    ? roundToIncrement(toX18(touch * (isLong ? 1 - slippage : 1 + slippage)), p.priceIncrementX18, isLong ? 'down' : 'up')
    : 0n;
  if (!touch) errors.push('No market price available for this market right now.');

  const notional = touch ? fromX18(closing) * touch : 0;
  if (touch && closing > 0n && toX18(notional) < p.minOrderValueX18) {
    errors.push(
      `Closing that share is only about $${notional.toFixed(2)}, below this market's $${fromX18(p.minOrderValueX18)} minimum order. Close a larger share.`
    );
  }

  return { amount, limitPriceX18, notional, fractionClosed: size > 0n ? Number((closing * 10_000n) / size) / 10_000 : 0, errors };
}

/** Places the closing order: one signature, immediate-or-cancel and reduce-only, so it can never flip the position. */
export async function closePosition(
  network: NadoNetwork,
  sign: SignTypedDataAsync,
  p: { productId: number; sender: `0x${string}`; plan: ClosePlan }
): Promise<string> {
  if (p.plan.errors.length) throw new Error(p.plan.errors[0]);
  return placeOrder(network, sign, {
    productId: p.productId,
    sender: p.sender,
    priceX18: p.plan.limitPriceX18,
    amount: p.plan.amount,
    orderType: OrderType.IOC,
    reduceOnly: true,
    expiresInSeconds: 60,
  });
}

/* ---------------------------------- moving a stop-loss or take-profit ---------------------------------- */

export interface TriggerEditPlan {
  triggerX18: bigint;
  /** Worst price the exit may fill at, EXIT_SLIPPAGE past the trigger in the closing direction. */
  limitX18: bigint;
  errors: string[];
}

/**
 * Pure: prices a moved exit. `closesLong` is true when the exit sells (protecting a long). `above` keeps the original
 * condition: an exit that fires when price rises stays that way, it only moves to a new level.
 */
export function planTriggerEdit(p: {
  triggerPrice: number;
  closesLong: boolean;
  above: boolean;
  priceIncrementX18: bigint;
  /** Last traded price, used to refuse a level that has already been passed. */
  marketPrice?: number | null;
}): TriggerEditPlan {
  const errors: string[] = [];
  if (!(p.triggerPrice > 0)) errors.push('Enter a trigger price.');
  const tick = (value: number, mode: RoundMode) => roundToIncrement(toX18(value), p.priceIncrementX18, mode);
  const triggerX18 = tick(p.triggerPrice, 'nearest');
  const exitMode: RoundMode = p.closesLong ? 'down' : 'up';
  const worse = p.closesLong ? 1 - EXIT_SLIPPAGE : 1 + EXIT_SLIPPAGE;
  const limitX18 = tick(fromX18(triggerX18) * worse, exitMode);

  if (p.triggerPrice > 0 && p.marketPrice) {
    const level = fromX18(triggerX18);
    if (p.above ? p.marketPrice >= level : p.marketPrice <= level) {
      errors.push(
        `The market is already ${p.above ? 'at or above' : 'at or below'} ${formatPrice(level, p.priceIncrementX18)}, so this would fire straight away. Move it ${p.above ? 'higher' : 'lower'}.`
      );
    }
  }
  return { triggerX18, limitX18, errors };
}

export interface TriggerEditResult {
  digest: string;
  /** False when the old exit could not be cancelled and is still live alongside the new one. */
  oldCancelled: boolean;
}

/**
 * Moves an exit to a new price: places the replacement first, then cancels the old one. In that order a rejected
 * second signature leaves the position over-protected rather than unprotected; both are reduce-only, so whichever
 * fires first closes the position and the other can only be a no-op.
 */
export async function replaceTriggerOrder(
  network: NadoNetwork,
  sign: SignTypedDataAsync,
  p: {
    productId: number;
    sender: `0x${string}`;
    oldDigest: string;
    amount: bigint;
    plan: TriggerEditPlan;
    above: boolean;
    /** Entry this exit waits for, when it hasn't been activated yet. */
    dependsOn?: string;
    expiresInSeconds?: number;
  }
): Promise<TriggerEditResult> {
  if (p.plan.errors.length) throw new Error(p.plan.errors[0]);
  const digest = await placeTriggerOrder(network, sign, {
    productId: p.productId,
    sender: p.sender,
    priceX18: p.plan.limitX18,
    amount: p.amount,
    priceRequirement: p.above ? { last_price_above: p.plan.triggerX18.toString() } : { last_price_below: p.plan.triggerX18.toString() },
    reduceOnly: true,
    dependsOn: p.dependsOn,
    expiresInSeconds: p.expiresInSeconds,
  });
  try {
    await cancelOrders(network, sign, 'trigger', p.sender, [{ productId: p.productId, digest: p.oldDigest }]);
  } catch {
    return { digest, oldCancelled: false };
  }
  return { digest, oldCancelled: true };
}

/* ---------------------------------- market orders ---------------------------------- */

/** How far past the touch a market order may fill. It is IOC, so this caps the price rather than setting it. */
export const MARKET_SLIPPAGE_PERCENT = 1;

export interface MarketOrderPlan {
  /** Signed: positive buys, negative sells. */
  amount: bigint;
  limitPriceX18: bigint;
  /** Price the order is expected to fill near (the touch), used for value and exits. */
  expectedPrice: number;
  notional: number;
  /** Trigger prices for optional exits, from the expected fill price. */
  stopX18: bigint | null;
  takeProfitX18: bigint | null;
  errors: string[];
}

/**
 * Pure: a market order as an immediate-or-cancel limit at the touch plus a slippage cap: a buy lifts the ask, a sell
 * hits the bid, and nothing fills worse than the cap.
 */
export function planMarketOrder(p: {
  side: 'long' | 'short';
  size: number;
  bid: number | null;
  ask: number | null;
  stopLossPercent?: number | null;
  takeProfitPercent?: number | null;
  slippagePercent?: number;
  priceIncrementX18: bigint;
  sizeIncrementX18: bigint;
  minOrderValueX18: bigint;
}): MarketOrderPlan {
  const errors: string[] = [];
  const long = p.side === 'long';
  const touch = long ? p.ask : p.bid;
  const slippage = (p.slippagePercent ?? MARKET_SLIPPAGE_PERCENT) / 100;
  const lots = roundToIncrement(toX18(Math.max(p.size || 0, 0)), p.sizeIncrementX18, 'down');
  const amount = long ? lots : -lots;

  if (!touch) errors.push('No market price available for this market right now.');
  if (lots === 0n) errors.push("Size is below this market's minimum lot size.");

  const limitPriceX18 = touch ? roundToIncrement(toX18(touch * (long ? 1 + slippage : 1 - slippage)), p.priceIncrementX18, long ? 'up' : 'down') : 0n;
  const notional = touch ? fromX18(lots) * touch : 0;
  if (touch && lots > 0n && toX18(notional) < p.minOrderValueX18) {
    errors.push(`Order value ${notional.toLocaleString('en-US', { style: 'currency', currency: 'USD' })} is below this market's $${fromX18(p.minOrderValueX18)} minimum.`);
  }

  const tick = (v: number) => roundToIncrement(toX18(v), p.priceIncrementX18, 'nearest');
  const sl = p.stopLossPercent && p.stopLossPercent > 0 ? p.stopLossPercent : null;
  const tp = p.takeProfitPercent && p.takeProfitPercent > 0 ? p.takeProfitPercent : null;
  if (sl !== null && sl >= 100) errors.push('Stop-loss must be below 100%.');
  const stopX18 = touch && sl !== null ? tick(touch * (long ? 1 - sl / 100 : 1 + sl / 100)) : null;
  const takeProfitX18 = touch && tp !== null ? tick(touch * (long ? 1 + tp / 100 : 1 - tp / 100)) : null;

  return { amount, limitPriceX18, expectedPrice: touch ?? 0, notional, stopX18, takeProfitX18, errors };
}

/** Places the market order: one signature, immediate-or-cancel, not reduce-only (it opens or adds to a position). */
export async function placeMarketOrder(network: NadoNetwork, sign: SignTypedDataAsync, p: { productId: number; sender: `0x${string}`; plan: MarketOrderPlan }) {
  if (p.plan.errors.length) throw new Error(p.plan.errors[0]);
  return placeOrder(network, sign, {
    productId: p.productId,
    sender: p.sender,
    priceX18: p.plan.limitPriceX18,
    amount: p.plan.amount,
    orderType: OrderType.IOC,
    expiresInSeconds: 60,
  });
}

/**
 * Pure: how much of a market order filled, from the position before and after, never more than was ordered. Protection
 * is sized to this, so a partial fill gets exits for exactly what was bought or sold.
 */
export function filledAmount(before: bigint, after: bigint, ordered: bigint): bigint {
  const delta = after - before;
  if (ordered > 0n) return delta > 0n ? (delta > ordered ? ordered : delta) : 0n;
  return delta < 0n ? (delta < ordered ? ordered : delta) : 0n;
}

/**
 * Attaches a stop-loss and/or take-profit to what a market order filled: reduce-only triggers sized to the fill, the
 * same orders "Protect position" places. `filled` is signed like the order (positive for a buy).
 */
export async function protectFill(
  network: NadoNetwork,
  sign: SignTypedDataAsync,
  p: { productId: number; sender: `0x${string}`; filled: bigint; plan: MarketOrderPlan; priceIncrementX18: bigint }
) {
  const long = p.filled > 0n;
  const worse = long ? 1 - EXIT_SLIPPAGE : 1 + EXIT_SLIPPAGE;
  const exitMode: RoundMode = long ? 'down' : 'up';
  const limit = (triggerX18: bigint) => roundToIncrement(toX18(fromX18(triggerX18) * worse), p.priceIncrementX18, exitMode);
  const placed: string[] = [];
  if (p.plan.stopX18 !== null) {
    const at = p.plan.stopX18.toString();
    placed.push(
      await placeTriggerOrder(network, sign, {
        productId: p.productId,
        sender: p.sender,
        priceX18: limit(p.plan.stopX18),
        amount: -p.filled,
        priceRequirement: long ? { last_price_below: at } : { last_price_above: at },
      })
    );
  }
  if (p.plan.takeProfitX18 !== null) {
    const at = p.plan.takeProfitX18.toString();
    placed.push(
      await placeTriggerOrder(network, sign, {
        productId: p.productId,
        sender: p.sender,
        priceX18: limit(p.plan.takeProfitX18),
        amount: -p.filled,
        priceRequirement: long ? { last_price_above: at } : { last_price_below: at },
      })
    );
  }
  return placed;
}
