import axios from 'axios';
import { ENV } from '../config/env';

/**
 * The verifying contract for order signing is address(productId) - a fixed
 * pseudo-address, NOT the endpoint contract address.
 * e.g. product 1 -> 0x0000000000000000000000000000000000000001
 * See: https://docs.nado.xyz/developer-resources/api/gateway/signing
 */
export function verifyingContractForProduct(productId: number): `0x${string}` {
  return `0x${productId.toString(16).padStart(40, '0')}` as `0x${string}`;
}

let cachedEndpointAddr: `0x${string}` | null = null;

/**
 * Every execute EXCEPT place_order (cancellations, withdrawals, list-trigger-orders, ...)
 * is signed against the Nado "endpoint" contract address, fetched via the contracts query.
 */
export async function fetchEndpointAddress(): Promise<`0x${string}`> {
  if (cachedEndpointAddr) return cachedEndpointAddr;
  const response = await axios.get(`${ENV.NADO_GATEWAY_URL}/query`, {
    params: { type: 'contracts' },
    headers: { 'Accept-Encoding': 'gzip, br, deflate' },
  });
  cachedEndpointAddr = response.data.data.endpoint_addr as `0x${string}`;
  return cachedEndpointAddr;
}

export function nadoDomain(verifyingContract: `0x${string}`) {
  return {
    name: 'Nado',
    version: '0.0.1',
    chainId: ENV.CHAIN_ID,
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

export const CANCELLATION_TYPES = {
  Cancellation: [
    { name: 'sender', type: 'bytes32' },
    { name: 'productIds', type: 'uint32[]' },
    { name: 'digests', type: 'bytes32[]' },
    { name: 'nonce', type: 'uint64' },
  ],
} as const;

export const LIST_TRIGGER_ORDERS_TYPES = {
  ListTriggerOrders: [
    { name: 'sender', type: 'bytes32' },
    { name: 'recvTime', type: 'uint64' },
  ],
} as const;
