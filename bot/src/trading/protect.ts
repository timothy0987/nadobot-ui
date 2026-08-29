import { ENV } from '../config/env';
import { getPerpPosition } from './position';
import { placeTriggerOrder, listTriggerOrders } from './trigger';

const SLIPPAGE_TOLERANCE = 0.005; // 0.5% - execution limit buffer past the trigger price so the IOC fill goes through

function scale(priceX18: bigint, multiplier: number): bigint {
  // multiplier applied with 6 decimal precision to keep BigInt math exact
  const factor = BigInt(Math.round(multiplier * 1_000_000));
  return (priceX18 * factor) / 1_000_000n;
}

/**
 * Ensures any open position on `productId` has a live stop-loss and take-profit
 * trigger order registered with Nado's server-side trigger service. These triggers
 * live on Nado's infrastructure and fire even if this bot process is offline -
 * that's what keeps a trade "ongoing" while the user (or the bot host) is down.
 */
export async function protectOpenPosition(sender: `0x${string}`, productId: number) {
  const position = await getPerpPosition(sender, productId);
  if (!position) return;

  const existing = await listTriggerOrders(sender, [productId]);
  const activeReduceOnly = existing.filter(
    (o) => o.order?.order && BigInt(o.order.order.amount) !== 0n && o.status === 'waiting_price'
  );

  const isLong = position.amount > 0n;
  const exitAmount = -position.amount; // reduce-only order in the opposite direction of the position

  const stopPrice = isLong
    ? scale(position.avgEntryPriceX18, 1 - ENV.STOP_LOSS_PERCENT)
    : scale(position.avgEntryPriceX18, 1 + ENV.STOP_LOSS_PERCENT);
  const takeProfitPrice = isLong
    ? scale(position.avgEntryPriceX18, 1 + ENV.TAKE_PROFIT_PERCENT)
    : scale(position.avgEntryPriceX18, 1 - ENV.TAKE_PROFIT_PERCENT);

  const hasStopLoss = activeReduceOnly.some((o) => o.order.order?.priceX18 && closeEnough(BigInt(o.order.order.priceX18), stopPrice));
  const hasTakeProfit = activeReduceOnly.some((o) => o.order.order?.priceX18 && closeEnough(BigInt(o.order.order.priceX18), takeProfitPrice));

  if (activeReduceOnly.length >= 2 || (hasStopLoss && hasTakeProfit)) {
    return; // already protected
  }

  console.log(
    `Position on product ${productId}: ${isLong ? 'LONG' : 'SHORT'} ${position.amount}, avg entry ${position.avgEntryPriceX18}. Attaching protection...`
  );

  if (!hasStopLoss) {
    const limitPrice = isLong ? scale(stopPrice, 1 - SLIPPAGE_TOLERANCE) : scale(stopPrice, 1 + SLIPPAGE_TOLERANCE);
    await placeTriggerOrder({
      productId,
      sender,
      priceX18: limitPrice,
      amount: exitAmount,
      reduceOnly: true,
      priceRequirement: isLong ? { last_price_below: stopPrice.toString() } : { last_price_above: stopPrice.toString() },
    });
    console.log(`Stop-loss placed at ${stopPrice.toString()}`);
  }

  if (!hasTakeProfit) {
    const limitPrice = isLong ? scale(takeProfitPrice, 1 - SLIPPAGE_TOLERANCE) : scale(takeProfitPrice, 1 + SLIPPAGE_TOLERANCE);
    await placeTriggerOrder({
      productId,
      sender,
      priceX18: limitPrice,
      amount: exitAmount,
      reduceOnly: true,
      priceRequirement: isLong ? { last_price_above: takeProfitPrice.toString() } : { last_price_below: takeProfitPrice.toString() },
    });
    console.log(`Take-profit placed at ${takeProfitPrice.toString()}`);
  }
}

function closeEnough(a: bigint, b: bigint): boolean {
  const diff = a > b ? a - b : b - a;
  return diff < b / 100n; // within 1%
}

export function startPositionProtectionLoop(sender: `0x${string}`, productId: number) {
  const run = () => protectOpenPosition(sender, productId).catch((e) => console.error('Position protection check failed:', e.message));
  run();
  return setInterval(run, ENV.PROTECTION_CHECK_INTERVAL_SECONDS * 1000);
}
