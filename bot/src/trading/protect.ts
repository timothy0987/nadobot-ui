import { ENV } from '../config/env';
import { getPerpPosition, PerpPosition } from './position';
import { placeTriggerOrder, listTriggerOrders, cancelTriggerOrders, TriggerOrderEntry } from './trigger';
import { getProductIncrements } from './products';
import { roundToIncrement, RoundMode } from '../nado/ticks';
import { notify } from '../alerts';
import { botState, recordError } from '../state';

const SLIPPAGE_TOLERANCE = 0.005; // execution limit buffer past the trigger price so the IOC fill goes through
const PRICE_MATCH_TOLERANCE_BPS = 25n; // an existing order within 0.25% of the target price still counts as correct

const REDUCE_ONLY_BIT = 1n << 11n;

function scale(priceX18: bigint, multiplier: number): bigint {
  const factor = BigInt(Math.round(multiplier * 1_000_000));
  return (priceX18 * factor) / 1_000_000n;
}

const toNumber = (x18: bigint) => Number(x18) / 1e18;

export interface ProtectionPlan {
  isLong: boolean;
  exitAmount: bigint;
  stopPrice: bigint;
  takeProfitPrice: bigint;
  stopLimit: bigint;
  takeProfitLimit: bigint;
}

export function planProtection(
  position: PerpPosition,
  stopLossPct: number,
  takeProfitPct: number,
  priceIncrementX18: bigint
): ProtectionPlan {
  const isLong = position.amount > 0n;
  const tick = (price: bigint, mode: RoundMode) => roundToIncrement(price, priceIncrementX18, mode);
  const stopPrice = tick(scale(position.avgEntryPriceX18, isLong ? 1 - stopLossPct : 1 + stopLossPct), 'nearest');
  const takeProfitPrice = tick(scale(position.avgEntryPriceX18, isLong ? 1 + takeProfitPct : 1 - takeProfitPct), 'nearest');
  // Exits on a long are sells (round the limit down), on a short are buys (round up) - both stay marketable.
  const worse = isLong ? 1 - SLIPPAGE_TOLERANCE : 1 + SLIPPAGE_TOLERANCE;
  const limitMode: RoundMode = isLong ? 'down' : 'up';
  return {
    isLong,
    exitAmount: -position.amount,
    stopPrice,
    takeProfitPrice,
    stopLimit: tick(scale(stopPrice, worse), limitMode),
    takeProfitLimit: tick(scale(takeProfitPrice, worse), limitMode),
  };
}

function isReduceOnly(entry: TriggerOrderEntry) {
  return (BigInt(entry.order.order.appendix) & REDUCE_ONLY_BIT) !== 0n;
}

function priceMatches(actual: bigint, target: bigint) {
  const diff = actual > target ? actual - target : target - actual;
  return diff * 10_000n <= target * PRICE_MATCH_TOLERANCE_BPS;
}

export type ProtectionAction = 'none' | 'place' | 'replace' | 'cleanup';

/**
 * Pure decision: given the live position and the pending reduce-only trigger orders, what needs to happen.
 * Protection is only "correct" if there is exactly one stop-loss and one take-profit, both sized to the
 * current position - so a position that grew from repeated buys gets its orders replaced, not ignored.
 */
export function decideProtection(position: PerpPosition | null, pending: TriggerOrderEntry[], plan: ProtectionPlan | null): ProtectionAction {
  const managed = pending.filter(isReduceOnly);
  if (!position || !plan) return managed.length > 0 ? 'cleanup' : 'none';
  if (managed.length === 0) return 'place';
  if (managed.length !== 2) return 'replace';

  const sized = managed.every((o) => BigInt(o.order.order.amount) === plan.exitAmount);
  const prices = managed.map((o) => BigInt(o.order.order.priceX18));
  const hasStop = prices.some((p) => priceMatches(p, plan.stopLimit));
  const hasTakeProfit = prices.some((p) => priceMatches(p, plan.takeProfitLimit));
  return sized && hasStop && hasTakeProfit ? 'none' : 'replace';
}

let previousAmount: bigint | null = null;

/**
 * Keeps any open position on `productId` covered by exactly one stop-loss and one take-profit trigger order
 * on Nado's trigger service. Those orders live on Nado's servers, so they still fire if this bot goes offline.
 */
export async function protectOpenPosition(sender: `0x${string}`, productId: number) {
  const position = await getPerpPosition(sender, productId);
  const pending = await listTriggerOrders(sender, [productId]);
  const { priceIncrementX18 } = await getProductIncrements();
  const plan = position ? planProtection(position, ENV.STOP_LOSS_PERCENT, ENV.TAKE_PROFIT_PERCENT, priceIncrementX18) : null;
  const action = decideProtection(position, pending, plan);

  botState.lastProtectionCheckAt = new Date().toISOString();
  botState.position = position ? { amount: toNumber(position.amount), avgEntryPrice: toNumber(position.avgEntryPriceX18) } : null;

  if (previousAmount !== null && previousAmount !== 0n && !position) {
    await notify(`Position on ${ENV.PRODUCT_SYMBOL} closed (stop-loss or take-profit filled, or closed manually).`);
  }
  previousAmount = position?.amount ?? 0n;

  const managedDigests = pending.filter(isReduceOnly).map((o) => o.order.digest as `0x${string}`);

  if (action === 'none') {
    // Also covers a restart: correct orders already on Nado must show as protection, not "being placed".
    botState.protection = plan
      ? { stopPrice: toNumber(plan.stopPrice), takeProfitPrice: toNumber(plan.takeProfitPrice), size: Math.abs(toNumber(position!.amount)), digests: managedDigests }
      : null;
    return action;
  }

  if (action === 'cleanup' || action === 'replace') {
    await cancelTriggerOrders(sender, productId, managedDigests);
  }
  if (action === 'cleanup') {
    botState.protection = null;
    console.log(`Cancelled ${managedDigests.length} leftover protection order(s) - no open position.`);
    return action;
  }

  const p = plan!;
  const stop = await placeTriggerOrder({
    productId,
    sender,
    priceX18: p.stopLimit,
    amount: p.exitAmount,
    reduceOnly: true,
    priceRequirement: p.isLong ? { last_price_below: p.stopPrice.toString() } : { last_price_above: p.stopPrice.toString() },
  });
  const takeProfit = await placeTriggerOrder({
    productId,
    sender,
    priceX18: p.takeProfitLimit,
    amount: p.exitAmount,
    reduceOnly: true,
    priceRequirement: p.isLong
      ? { last_price_above: p.takeProfitPrice.toString() }
      : { last_price_below: p.takeProfitPrice.toString() },
  });

  const size = Math.abs(toNumber(position!.amount));
  botState.protection = {
    stopPrice: toNumber(p.stopPrice),
    takeProfitPrice: toNumber(p.takeProfitPrice),
    size,
    digests: [stop.data?.digest, takeProfit.data?.digest].filter(Boolean),
  };
  await notify(
    `${action === 'place' ? 'Protection placed' : 'Protection resized'} on ${p.isLong ? 'LONG' : 'SHORT'} ${size} ${ENV.PRODUCT_SYMBOL}: ` +
      `stop-loss $${toNumber(p.stopPrice).toFixed(2)}, take-profit $${toNumber(p.takeProfitPrice).toFixed(2)}.`
  );
  return action;
}

export function startPositionProtectionLoop(sender: `0x${string}`, productId: number) {
  let running = false; // a cancel + re-place cycle can outlast the interval; never run two at once
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await protectOpenPosition(sender, productId);
    } catch (e: any) {
      const message = e.response?.data?.error ?? e.message;
      console.error('Position protection check failed:', message);
      recordError(`protection: ${message}`);
    } finally {
      running = false;
    }
  };
  run();
  return setInterval(run, ENV.PROTECTION_CHECK_INTERVAL_SECONDS * 1000);
}
