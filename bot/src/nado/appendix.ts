/**
 * Encodes the Nado order "appendix" - a uint128 packing extra order parameters.
 * Bit layout (LSB to MSB), per https://docs.nado.xyz order-appendix docs:
 *   version           bits 0-7    (8 bits)  - protocol version, currently 1
 *   isolated          bit  8      (1 bit)
 *   orderType         bits 9-10   (2 bits)  - 0 DEFAULT, 1 IOC, 2 FOK, 3 POST_ONLY
 *   reduceOnly        bit  11     (1 bit)
 *   triggerType       bits 12-13  (2 bits)  - 0 NONE, 1 PRICE, 2 TWAP, 3 TWAP_CUSTOM_AMOUNTS
 *   reserved          bits 14-37  (24 bits)
 *   builderFeeRateTenthBps bits 38-47 (10 bits) - fee rate in 0.1bps units
 *   builderId         bits 48-63  (16 bits)
 *   value             bits 64-127 (64 bits) - isolated margin (x6) or TWAP params
 */

export const OrderType = {
  DEFAULT: 0,
  IOC: 1,
  FOK: 2,
  POST_ONLY: 3,
} as const;

export const TriggerType = {
  NONE: 0,
  PRICE: 1,
  TWAP: 2,
  TWAP_CUSTOM_AMOUNTS: 3,
} as const;

export interface AppendixParams {
  isolated?: boolean;
  orderType?: number;
  reduceOnly?: boolean;
  triggerType?: number;
  builderFeeRateTenthBps?: number;
  builderId?: number;
  value?: bigint;
}

export function encodeAppendix(params: AppendixParams = {}): bigint {
  const {
    isolated = false,
    orderType = OrderType.DEFAULT,
    reduceOnly = false,
    triggerType = TriggerType.NONE,
    builderFeeRateTenthBps = 0,
    builderId = 0,
    value = 0n,
  } = params;

  const version = 1n;
  let appendix = version;
  appendix |= (isolated ? 1n : 0n) << 8n;
  appendix |= BigInt(orderType) << 9n;
  appendix |= (reduceOnly ? 1n : 0n) << 11n;
  appendix |= BigInt(triggerType) << 12n;
  appendix |= BigInt(builderFeeRateTenthBps) << 38n;
  appendix |= BigInt(builderId) << 48n;
  appendix |= value << 64n;

  return appendix;
}
