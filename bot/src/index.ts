import { startPriceFeedListener, priceX18ToNumber } from './ws/priceFeed';
import { placeOrder } from './trading/order';
import { getSubaccountInfo, getOpenOrders } from './trading/query';
import { resolveProductId } from './trading/products';
import { startPositionProtectionLoop } from './trading/protect';
import { subaccountToBytes32 } from './nado/subaccount';
import { OrderType } from './nado/appendix';
import { ENV } from './config/env';
import { account } from './viem/client';

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

  try {
    const info = await getSubaccountInfo(sender);
    console.log('Subaccount exists:', info.data.exists);

    const orders = await getOpenOrders(sender);
    console.log(`Open orders: ${orders.data?.orders?.length ?? 0}`);
  } catch (error) {
    console.error('Failed to fetch info on startup:', error);
  }

  // Keeps any open position (whether opened by this bot or manually) protected with a
  // server-side stop-loss/take-profit even if this process goes offline.
  if (ENV.ENABLE_POSITION_PROTECTION) {
    startPositionProtectionLoop(sender, productId);
    console.log(
      `Position protection active: SL -${ENV.STOP_LOSS_PERCENT * 100}% / TP +${ENV.TAKE_PROFIT_PERCENT * 100}%, checked every ${ENV.PROTECTION_CHECK_INTERVAL_SECONDS}s`
    );
  }

  if (!ENV.ENABLE_DIP_BUY) {
    console.log('Dip-buy entry strategy disabled (ENABLE_DIP_BUY=false). Running in protection-only mode.');
    return;
  }

  let maxPrice = 0;
  let cooldownUntil = 0;

  startPriceFeedListener(productId, async (trade) => {
    const currentPrice = priceX18ToNumber(trade.price);
    if (currentPrice > maxPrice) maxPrice = currentPrice;

    const dropThreshold = maxPrice * (1 - ENV.TRADE_DROP_PERCENTAGE);
    if (currentPrice > dropThreshold || Date.now() < cooldownUntil) return;

    console.log(`Price dropped to ${currentPrice} (max was ${maxPrice}). Placing buy order...`);
    cooldownUntil = Date.now() + 60_000; // avoid re-triggering on every tick while the order settles

    try {
      // Willing to pay up to 0.2% above the observed price so the IOC buy actually fills as taker.
      const limitPrice = BigInt(Math.floor(currentPrice * 1.002 * 1e18));
      await placeOrder({
        productId,
        sender,
        priceX18: limitPrice,
        amount: BigInt(Math.floor(ENV.TRADE_AMOUNT * 1e18)),
        appendix: { orderType: OrderType.IOC },
      });
      maxPrice = currentPrice; // reset so we don't immediately re-trigger
    } catch (e) {
      console.error('Error executing trade:', e);
    }
  });
}

main().catch(console.error);
