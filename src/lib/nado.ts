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
const REDUCE_ONLY_BIT = 1n << 11n;

/** Order appendix bit layout per docs.nado.xyz (version, order type, reduce-only, trigger type, builder). */
export function encodeAppendix(opts: { reduceOnly?: boolean; orderType?: number; triggerType?: number } = {}): bigint {
  const { reduceOnly = false, orderType = 0, triggerType = 0 } = opts;
  let appendix = 1n;
  appendix |= BigInt(orderType) << 9n;
  appendix |= (reduceOnly ? 1n : 0n) << 11n;
  appendix |= BigInt(triggerType) << 12n;
  appendix |= BigInt(BUILDER_FEE_RATE_TENTH_BPS) << 38n;
  appendix |= BigInt(BUILDER_ID) << 48n;
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
  submissionIdx: string;
  timestamp: number;
  baseFilled: number;
  quoteFilled: number;
  fee: number;
  realizedPnl: number;
  builderFee: number;
}

/** Recent fills for a subaccount from Nado's archive indexer. Public data, no signature needed. */
export async function fetchMatches(network: NadoNetwork, subaccount: string, productIds: number[], limit = 20): Promise<Match[]> {
  const res = await fetch(network.archiveUrl, {
    method: 'POST',
    headers: gatewayHeaders,
    body: JSON.stringify({ matches: { subaccounts: [subaccount], product_ids: productIds, limit } }),
  });
  const json = await res.json();
  const times = new Map<string, number>((json.txs ?? []).map((t: any) => [String(t.submission_idx), Number(t.timestamp)]));
  return (json.matches ?? []).map((m: any) => ({
    digest: m.digest,
    submissionIdx: String(m.submission_idx),
    timestamp: times.get(String(m.submission_idx)) ?? 0,
    baseFilled: fromX18(m.base_filled),
    quoteFilled: fromX18(m.quote_filled),
    fee: fromX18(m.fee),
    realizedPnl: fromX18(m.realized_pnl ?? '0'),
    builderFee: fromX18(m.builder_fee ?? '0'),
  }));
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
  status: string;
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
      status_types: ['waiting_price', 'waiting_dependency'],
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
  alertsConfigured: boolean;
}

export async function fetchBotStatus(): Promise<BotStatus> {
  const res = await fetch(`${BOT_STATUS_URL.replace(/\/$/, '')}/status`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Bot status endpoint returned ${res.status}`);
  return res.json();
}
