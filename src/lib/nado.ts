export interface NadoNetwork {
  chainId: number;
  label: string;
  gatewayUrl: string;
  triggerUrl: string;
  explorerUrl: string;
}

export const INK_SEPOLIA: NadoNetwork = {
  chainId: 763373,
  label: 'Ink Sepolia (Testnet)',
  gatewayUrl: 'https://gateway.test.nado.xyz/v1',
  triggerUrl: 'https://trigger.test.nado.xyz/v1',
  explorerUrl: 'https://explorer-sepolia.inkonchain.com',
};

export const INK_MAINNET: NadoNetwork = {
  chainId: 57073,
  label: 'Ink Mainnet',
  gatewayUrl: 'https://gateway.prod.nado.xyz/v1',
  triggerUrl: 'https://trigger.prod.nado.xyz/v1',
  explorerUrl: 'https://explorer.inkonchain.com',
};

export const NETWORKS: Record<number, NadoNetwork> = {
  [INK_SEPOLIA.chainId]: INK_SEPOLIA,
  [INK_MAINNET.chainId]: INK_MAINNET,
};

export function networkForChain(chainId: number | undefined): NadoNetwork {
  return (chainId && NETWORKS[chainId]) || INK_SEPOLIA;
}

const gatewayHeaders = { 'Accept-Encoding': 'gzip, br, deflate' };

/**
 * Nado subaccounts = 20-byte wallet address + 12-byte name. The name is the ASCII
 * text of the name (e.g. "default"), right-padded with zero bytes - NOT all-zero bytes.
 * See: https://docs.nado.xyz/developer-resources/get-started/core-concepts
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

export function nadoDomain(network: NadoNetwork, verifyingContract: `0x${string}`) {
  return {
    name: 'Nado',
    version: '0.0.1',
    chainId: network.chainId,
    verifyingContract,
  } as const;
}

export const ORDER_TYPES = {
  Order: [
    { name: 'sender', type: 'bytes32' },
    { name: 'priceX18', type: 'int128' },
    { name: 'amount', type: 'int128' },
    { name: 'expiration', type: 'uint64' },
    { name: 'nonce', type: 'uint64' },
    { name: 'appendix', type: 'uint128' },
  ],
} as const;

export const LIST_TRIGGER_ORDERS_TYPES = {
  ListTriggerOrders: [
    { name: 'sender', type: 'bytes32' },
    { name: 'recvTime', type: 'uint64' },
  ],
} as const;

/** See docs.nado.xyz order-appendix bit layout. Only the fields the dashboard needs. */
export function encodeAppendix(opts: { reduceOnly?: boolean; orderType?: number; triggerType?: number } = {}): bigint {
  const { reduceOnly = false, orderType = 0, triggerType = 0 } = opts;
  let appendix = 1n; // version
  appendix |= BigInt(orderType) << 9n;
  appendix |= (reduceOnly ? 1n : 0n) << 11n;
  appendix |= BigInt(triggerType) << 12n;
  return appendix;
}

export function buildNonce(discardAfterMs = 60_000): bigint {
  const recvTime = BigInt(Date.now() + discardAfterMs);
  const random = BigInt(Math.floor(Math.random() * (1 << 20)));
  return (recvTime << 20n) + random;
}

export async function fetchSubaccountInfo(network: NadoNetwork, sender: string) {
  const res = await fetch(`${network.gatewayUrl}/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...gatewayHeaders },
    body: JSON.stringify({ type: 'subaccount_info', subaccount: sender }),
  });
  return res.json();
}

export async function fetchOpenOrders(network: NadoNetwork, sender: string) {
  const res = await fetch(`${network.gatewayUrl}/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...gatewayHeaders },
    body: JSON.stringify({ type: 'subaccount_orders', subaccount: sender }),
  });
  return res.json();
}

export async function fetchSymbols(network: NadoNetwork) {
  const res = await fetch(`${network.gatewayUrl}/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...gatewayHeaders },
    body: JSON.stringify({ type: 'symbols' }),
  });
  const json = await res.json();
  return json.data.symbols as Record<
    string,
    { type: string; product_id: number; symbol: string; trading_status: string }
  >;
}

let cachedEndpointAddr: Record<number, `0x${string}`> = {};

/** Every trigger-service execute is signed against the Nado "endpoint" contract, not address(productId). */
export async function fetchEndpointAddress(network: NadoNetwork): Promise<`0x${string}`> {
  if (cachedEndpointAddr[network.chainId]) return cachedEndpointAddr[network.chainId];
  const res = await fetch(`${network.gatewayUrl}/query?type=contracts`, { headers: gatewayHeaders });
  const json = await res.json();
  cachedEndpointAddr[network.chainId] = json.data.endpoint_addr;
  return json.data.endpoint_addr;
}

export interface PerpPosition {
  productId: number;
  amount: bigint;
  avgEntryPriceX18: bigint;
}

export function extractPerpPosition(subaccountInfo: any, productId: number): PerpPosition | null {
  const balance = subaccountInfo?.data?.perp_balances?.find((b: any) => b.product_id === productId);
  if (!balance) return null;
  const amount = BigInt(balance.balance.amount);
  if (amount === 0n) return null;
  const vQuote = BigInt(balance.balance.v_quote_balance);
  const avgEntryPriceX18 = (-vQuote * 10n ** 18n) / amount;
  return { productId, amount, avgEntryPriceX18 };
}

type SignTypedDataAsync = (args: {
  domain: any;
  types: any;
  primaryType: string;
  message: any;
}) => Promise<`0x${string}`>;

export type PriceRequirement =
  | { oracle_price_above: string }
  | { oracle_price_below: string }
  | { last_price_above: string }
  | { last_price_below: string };

/** Places a client-signed stop-loss/take-profit style trigger order using the connected wallet. */
export async function placeTriggerOrder(
  network: NadoNetwork,
  signTypedDataAsync: SignTypedDataAsync,
  params: {
    productId: number;
    sender: `0x${string}`;
    priceX18: bigint;
    amount: bigint;
    priceRequirement: PriceRequirement;
    reduceOnly?: boolean;
  }
) {
  const { productId, sender, priceX18, amount, priceRequirement, reduceOnly = true } = params;
  const order = {
    sender,
    priceX18,
    amount,
    expiration: BigInt(Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30),
    nonce: buildNonce(),
    appendix: encodeAppendix({ reduceOnly, orderType: 1 /* IOC */, triggerType: 1 /* PRICE */ }),
  };

  const domain = nadoDomain(network, verifyingContractForProduct(productId));
  const signature = await signTypedDataAsync({
    domain,
    types: ORDER_TYPES,
    primaryType: 'Order',
    message: order,
  });

  const res = await fetch(`${network.triggerUrl}/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...gatewayHeaders },
    body: JSON.stringify({
      place_order: {
        product_id: productId,
        order: {
          sender: order.sender,
          priceX18: order.priceX18.toString(),
          amount: order.amount.toString(),
          expiration: order.expiration.toString(),
          nonce: order.nonce.toString(),
          appendix: order.appendix.toString(),
        },
        signature,
        trigger: { price_trigger: { price_requirement: priceRequirement } },
      },
    }),
  });
  return res.json();
}

/** Lists pending stop-loss/take-profit trigger orders for a subaccount, signed with the connected wallet. */
export async function listTriggerOrders(
  network: NadoNetwork,
  signTypedDataAsync: SignTypedDataAsync,
  sender: `0x${string}`,
  productIds?: number[]
) {
  const recvTime = BigInt(Date.now() + 60_000);
  const endpointAddr = await fetchEndpointAddress(network);
  const domain = nadoDomain(network, endpointAddr);

  const signature = await signTypedDataAsync({
    domain,
    types: LIST_TRIGGER_ORDERS_TYPES,
    primaryType: 'ListTriggerOrders',
    message: { sender, recvTime },
  });

  const res = await fetch(`${network.triggerUrl}/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...gatewayHeaders },
    body: JSON.stringify({
      type: 'list_trigger_orders',
      tx: { sender, recvTime: recvTime.toString() },
      signature,
      ...(productIds ? { product_ids: productIds } : {}),
      status_types: ['waiting_price', 'waiting_dependency'],
    }),
  });
  const json = await res.json();
  return json.orders ?? [];
}
