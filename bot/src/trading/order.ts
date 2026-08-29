import axios from 'axios';
import { ENV } from '../config/env';
import { account } from '../viem/client';
import { nadoDomain, verifyingContractForProduct, ORDER_TYPES } from '../nado/domain';
import { encodeAppendix, AppendixParams } from '../nado/appendix';

export interface NadoOrder {
  sender: `0x${string}`;
  priceX18: bigint;
  amount: bigint;
  expiration: bigint;
  nonce: bigint;
  appendix: bigint;
}

/** Packs a random nonce + discard time per Nado's spec: top 44 bits = recv_time ms, bottom 20 bits = random. */
export function buildNonce(discardAfterMs = 60_000): bigint {
  const recvTime = BigInt(Date.now() + discardAfterMs);
  const random = BigInt(Math.floor(Math.random() * (1 << 20)));
  return (recvTime << 20n) + random;
}

export async function signOrder(order: NadoOrder, productId: number) {
  if (!account) throw new Error('Wallet account not initialized. Check PRIVATE_KEY.');

  const domain = nadoDomain(verifyingContractForProduct(productId));

  return account.signTypedData({
    domain,
    types: ORDER_TYPES,
    primaryType: 'Order',
    message: order,
  });
}

const gatewayHeaders = { 'Accept-Encoding': 'gzip, br, deflate' };

interface PlaceOrderParams {
  productId: number;
  sender: `0x${string}`;
  priceX18: bigint;
  amount: bigint;
  expiration?: bigint;
  appendix?: AppendixParams;
  reduceOnly?: boolean;
}

export async function placeOrder({
  productId,
  sender,
  priceX18,
  amount,
  expiration = BigInt(Math.floor(Date.now() / 1000) + 3600),
  appendix = {},
  reduceOnly = false,
}: PlaceOrderParams) {
  const order: NadoOrder = {
    sender,
    priceX18,
    amount,
    expiration,
    nonce: buildNonce(),
    appendix: encodeAppendix({
      ...appendix,
      reduceOnly,
      builderId: ENV.BUILDER_ID,
      builderFeeRateTenthBps: ENV.BUILDER_FEE_RATE_TENTH_BPS,
    }),
  };

  const signature = await signOrder(order, productId);

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
    },
  };

  const response = await axios.post(`${ENV.NADO_GATEWAY_URL}/execute`, payload, { headers: gatewayHeaders });
  if (response.data.status !== 'success') {
    throw new Error(`Order rejected: ${response.data.error} (${response.data.error_code})`);
  }
  console.log('Order submitted successfully:', response.data.data);
  return response.data;
}
