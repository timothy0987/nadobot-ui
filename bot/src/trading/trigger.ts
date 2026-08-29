import axios from 'axios';
import { ENV } from '../config/env';
import { account } from '../viem/client';
import {
  nadoDomain,
  verifyingContractForProduct,
  fetchEndpointAddress,
  ORDER_TYPES,
  LIST_TRIGGER_ORDERS_TYPES,
} from '../nado/domain';
import { encodeAppendix, TriggerType, OrderType } from '../nado/appendix';
import { buildNonce } from './order';

const headers = { 'Accept-Encoding': 'gzip, br, deflate' };

export type PriceRequirement =
  | { oracle_price_above: string }
  | { oracle_price_below: string }
  | { last_price_above: string }
  | { last_price_below: string }
  | { mid_price_above: string }
  | { mid_price_below: string };

interface PlaceTriggerOrderParams {
  productId: number;
  sender: `0x${string}`;
  /** Limit price the order executes at once triggered */
  priceX18: bigint;
  /** Signed amount: negative for sell/close-long, positive for buy/close-short */
  amount: bigint;
  priceRequirement: PriceRequirement;
  reduceOnly?: boolean;
  expiration?: bigint;
}

/** Places a stop-loss / take-profit style conditional order on Nado's server-side trigger service. */
export async function placeTriggerOrder({
  productId,
  sender,
  priceX18,
  amount,
  priceRequirement,
  reduceOnly = true,
  expiration = BigInt(Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30), // 30 days
}: PlaceTriggerOrderParams) {
  if (!account) throw new Error('Wallet account not initialized. Check PRIVATE_KEY.');

  const order = {
    sender,
    priceX18,
    amount,
    expiration,
    nonce: buildNonce(60_000),
    appendix: encodeAppendix({
      reduceOnly,
      triggerType: TriggerType.PRICE,
      orderType: OrderType.IOC, // execute immediately (or cancel) once the trigger fires, like a stop-market order
      builderId: ENV.BUILDER_ID,
      builderFeeRateTenthBps: ENV.BUILDER_FEE_RATE_TENTH_BPS,
    }),
  };

  const domain = nadoDomain(verifyingContractForProduct(productId));
  const signature = await account.signTypedData({
    domain,
    types: ORDER_TYPES,
    primaryType: 'Order',
    message: order,
  });

  const payload = {
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
  };

  const response = await axios.post(`${ENV.NADO_TRIGGER_URL}/execute`, payload, { headers });
  if (response.data.status !== 'success') {
    throw new Error(`Trigger order rejected: ${response.data.error} (${response.data.error_code})`);
  }
  return response.data;
}

export async function listTriggerOrders(sender: `0x${string}`, productIds?: number[]) {
  if (!account) throw new Error('Wallet account not initialized. Check PRIVATE_KEY.');

  const recvTime = BigInt(Date.now() + 60_000);
  const endpointAddr = await fetchEndpointAddress();
  const domain = nadoDomain(endpointAddr);

  const tx = { sender, recvTime };
  const signature = await account.signTypedData({
    domain,
    types: LIST_TRIGGER_ORDERS_TYPES,
    primaryType: 'ListTriggerOrders',
    message: tx,
  });

  const payload = {
    type: 'list_trigger_orders',
    tx: { sender: tx.sender, recvTime: tx.recvTime.toString() },
    signature,
    ...(productIds ? { product_ids: productIds } : {}),
    status_types: ['waiting_price', 'waiting_dependency'],
  };

  const response = await axios.post(`${ENV.NADO_TRIGGER_URL}/query`, payload, { headers });
  if (response.data.status !== 'success') {
    throw new Error(`List trigger orders failed: ${response.data.error}`);
  }
  return response.data.orders as any[];
}
