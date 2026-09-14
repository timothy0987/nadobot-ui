import { startPriceFeedListener, priceX18ToNumber } from './ws/priceFeed';
import { placeOrder } from './trading/order';
import { getSubaccountInfo, getOpenOrders } from './trading/query';
import { resolveProductId, getProductIncrements } from './trading/products';
import { roundToIncrement } from './nado/ticks';
import { getPerpPosition } from './trading/position';
import { startPositionProtectionLoop } from './trading/protect';
import { subaccountToBytes32 } from './nado/subaccount';
import { OrderType } from './nado/appendix';
import { ENV } from './config/env';
import { account } from './viem/client';
import { notify, recordError } from './alerts';
import { botState } from './state';
import { startStatusServer } from './status';
import { initPush, startFillWatcher } from './push/service';
import { refreshRisk, currentBuyBlock, startRiskLoop } from './trading/risk';

/** Would buying TRADE_AMOUNT more push the position past MAX_POSITION_SIZE? */
export function exceedsPositionCap(currentAmount: number, tradeAmount: number, maxPositionSize: number) {
  return Math.abs(currentAmount + tradeAmount) > maxPositionSize + 1e-12;
}

async function main() {
  console.log(`Starting Nado Trading Bot on ${ENV.NADO_ENV.toUpperCase()} (${ENV.PRODUCT_SYMBOL})...`);

  if (!account) {
    console.error('No account found! Please set PRIVATE_KEY in .env');
    process.exit(1);
  }

  const sender = subaccountToBytes32(account.address, ENV.SUBACCOUNT_NAME);
  const productId = await resolveProductId();
  console.log(`Resolved ${ENV.PRODUCT_SYMBOL} -> product_id ${productId}`);
  console.log(`Subaccount: ${sender}`);
  initPush();
  startFillWatcher();
  startStatusServer(account.address, sender);

  try {
    const info = await getSubaccountInfo(sender);
    console.log('Subaccount exists:', info.data.exists);

    const orders = await getOpenOrders(sender, productId);
    console.log(`Open orders: ${orders.data?.orders?.length ?? 0}`);
  } catch (error) {
    console.error('Failed to fetch info on startup:', error);
  }

  if (ENV.ENABLE_POSITION_PROTECTION) {
    startPositionProtectionLoop(sender, productId);
    console.log(
      `Position protection active: SL -${ENV.STOP_LOSS_PERCENT * 100}% / TP +${ENV.TAKE_PROFIT_PERCENT * 100}%, checked every ${ENV.PROTECTION_CHECK_INTERVAL_SECONDS}s`
    );
  }

  startRiskLoop(sender);
  console.log(
    `Risk controls: kill switch ${ENV.TRADING_PAUSED ? 'ON (no new buys)' : 'off'}, daily loss limit ${
      ENV.DAILY_LOSS_LIMIT_USD > 0 ? `$${ENV.DAILY_LOSS_LIMIT_USD}` : 'disabled'
    }`
  );
  // Marks each restart in the dApp activity feed, since the in-memory log starts fresh.
  await notify(
    `Bot started on ${ENV.PRODUCT_SYMBOL}: buy ${ENV.TRADE_AMOUNT} on a ${ENV.TRADE_DROP_PERCENTAGE * 100}% dip (max ${ENV.MAX_POSITION_SIZE}), ` +
      `SL -${ENV.STOP_LOSS_PERCENT * 100}% / TP +${ENV.TAKE_PROFIT_PERCENT * 100}%, daily loss limit ${
        ENV.DAILY_LOSS_LIMIT_USD > 0 ? `$${ENV.DAILY_LOSS_LIMIT_USD}` : 'off'
      }.${ENV.TRADING_PAUSED ? ' Kill switch is ON: no new buys.' : ''}`
  );

  if (!ENV.ENABLE_DIP_BUY) {
    console.log('Dip-buy entry strategy disabled (ENABLE_DIP_BUY=false). Running in protection-only mode.');
    return;
  }
  console.log(`Dip-buy active: buy ${ENV.TRADE_AMOUNT} on a ${ENV.TRADE_DROP_PERCENTAGE * 100}% drop, max position ${ENV.MAX_POSITION_SIZE}`);

  let cooldownUntil = 0;

  startPriceFeedListener(productId, async (trade) => {
    const currentPrice = priceX18ToNumber(trade.price);
    botState.lastPrice = currentPrice;
    if (currentPrice > botState.sessionHigh) botState.sessionHigh = currentPrice;

    const dropThreshold = botState.sessionHigh * (1 - ENV.TRADE_DROP_PERCENTAGE);
    if (currentPrice > dropThreshold || Date.now() < cooldownUntil) return;
    cooldownUntil = Date.now() + 60_000; // avoid re-triggering on every tick while the order settles

    try {
      // Kill switch and daily loss limit are checked against fresh trade history right before every buy.
      await refreshRisk(sender);
      const blocked = currentBuyBlock();
      if (blocked) {
        if (botState.lastSkippedBuyReason !== blocked) console.log(`Skipped buy at $${currentPrice.toFixed(2)}: ${blocked}`);
        botState.lastSkippedBuyReason = blocked;
        botState.sessionHigh = currentPrice;
        return;
      }

      const before = await getPerpPosition(sender, productId);
      const beforeAmount = before ? Number(before.amount) / 1e18 : 0;
      if (exceedsPositionCap(beforeAmount, ENV.TRADE_AMOUNT, ENV.MAX_POSITION_SIZE)) {
        const reason = `Skipped buy at $${currentPrice.toFixed(2)}: position ${beforeAmount} + ${ENV.TRADE_AMOUNT} would exceed cap ${ENV.MAX_POSITION_SIZE}`;
        if (botState.lastSkippedBuyReason === null) await notify(reason, 'warn');
        botState.lastSkippedBuyReason = reason;
        console.log(reason);
        botState.sessionHigh = currentPrice;
        return;
      }
      botState.lastSkippedBuyReason = null;

      console.log(`Price dropped to ${currentPrice} (high was ${botState.sessionHigh}). Placing buy order...`);
      // Willing to pay up to 0.2% above the observed price so the IOC buy actually fills as taker.
      // Nado rejects prices/sizes that aren't exact multiples of the product's tick and lot size.
      const { priceIncrementX18, sizeIncrementX18 } = await getProductIncrements();
      const limitPrice = roundToIncrement(BigInt(Math.floor(currentPrice * 1.002 * 1e6)) * 10n ** 12n, priceIncrementX18, 'up');
      const amount = roundToIncrement(BigInt(Math.round(ENV.TRADE_AMOUNT * 1e9)) * 10n ** 9n, sizeIncrementX18, 'down');
      await placeOrder({
        productId,
        sender,
        priceX18: limitPrice,
        amount,
        appendix: { orderType: OrderType.IOC },
      });
      botState.sessionHigh = currentPrice; // reset so we don't immediately re-trigger

      await new Promise((r) => setTimeout(r, 3000));
      const after = await getPerpPosition(sender, productId);
      const afterAmount = after ? Number(after.amount) / 1e18 : 0;
      const filled = afterAmount - beforeAmount;
      if (filled > 0) {
        botState.lastBuyAt = new Date().toISOString();
        await notify(`Bought ${filled.toFixed(6)} ${ENV.PRODUCT_SYMBOL} near $${currentPrice.toFixed(2)} (position now ${afterAmount.toFixed(6)}).`);
      } else {
        console.log('Buy order was not filled (IOC expired without a match).');
      }
    } catch (e: any) {
      const message = e.response?.data?.error ?? e.message;
      console.error('Error executing trade:', message);
      recordError(`Buy attempt failed: ${message}`);
    }
  });
}

if (require.main === module) {
  main().catch(console.error);
}
