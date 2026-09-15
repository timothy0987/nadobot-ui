import { SUPPORTED_CHAIN_IDS } from './validate';

/** A price a subscriber asked to be told about, on one market of one network. */
export interface PriceAlert {
  id: string;
  chainId: number;
  productId: number;
  symbol: string;
  /** 'above' fires when the price reaches or passes the level from below; 'below' is the mirror. */
  direction: 'above' | 'below';
  price: number;
  createdAt: string;
  /** Price when the alert was created, so one already met is not fired the moment it is set. */
  priceWhenSet: number;
}

export const MAX_ALERTS_PER_SUBSCRIPTION = 20;
const SYMBOL = /^[A-Z0-9]{1,15}-PERP$/;

/** Pure: validates an alert request from the dashboard. Returns the stored alert, or a message for the client. */
export function parseAlert(body: any, now = new Date()): PriceAlert | { error: string } {
  const chainId = Number(body?.chainId);
  if (!SUPPORTED_CHAIN_IDS.includes(chainId)) return { error: 'Unsupported network' };
  const productId = Number(body?.productId);
  if (!Number.isInteger(productId) || productId < 0 || productId > 100_000) return { error: 'Invalid market' };
  const symbol = String(body?.symbol ?? '');
  if (!SYMBOL.test(symbol)) return { error: 'Invalid market' };
  if (body?.direction !== 'above' && body?.direction !== 'below') return { error: 'Invalid direction' };
  const price = Number(body?.price);
  if (!Number.isFinite(price) || price <= 0 || price > 1e12) return { error: 'Invalid price' };
  const priceWhenSet = Number(body?.priceWhenSet);
  if (!Number.isFinite(priceWhenSet) || priceWhenSet <= 0) return { error: 'Invalid current price' };
  // An alert that is already true would fire immediately, which is never what the trader meant.
  if (body.direction === 'above' && priceWhenSet >= price) return { error: 'That price is already above the market. Pick a higher price.' };
  if (body.direction === 'below' && priceWhenSet <= price) return { error: 'That price is already below the market. Pick a lower price.' };

  return {
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    chainId,
    productId,
    symbol,
    direction: body.direction,
    price,
    priceWhenSet,
    createdAt: now.toISOString(),
  };
}

/**
 * Pure: whether a price crossed the alert's level since the last check. Comparing against the previous price (or the
 * price when the alert was set) means a level is reported once, as it is crossed, not on every tick beyond it.
 */
export function alertTriggered(alert: PriceAlert, previousPrice: number, currentPrice: number): boolean {
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) return false;
  const before = Number.isFinite(previousPrice) && previousPrice > 0 ? previousPrice : alert.priceWhenSet;
  return alert.direction === 'above' ? before < alert.price && currentPrice >= alert.price : before > alert.price && currentPrice <= alert.price;
}

export const describeAlert = (alert: PriceAlert, price: number) =>
  `${alert.symbol} is ${alert.direction} $${alert.price.toLocaleString('en-US', { maximumFractionDigits: 6 })} (now $${price.toLocaleString('en-US', { maximumFractionDigits: 6 })})`;
