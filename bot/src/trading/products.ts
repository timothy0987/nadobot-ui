import axios from 'axios';
import { ENV } from '../config/env';

interface SymbolInfo {
  type: 'spot' | 'perp';
  product_id: number;
  symbol: string;
  price_increment_x18: string;
  size_increment: string;
  min_size: string;
  trading_status: string;
}

let cachedProductId: number | null = null;

const gatewayHeaders = { 'Accept-Encoding': 'gzip, br, deflate' };

export async function getSymbols(): Promise<Record<string, SymbolInfo>> {
  const response = await axios.post(
    `${ENV.NADO_GATEWAY_URL}/query`,
    { type: 'symbols' },
    { headers: gatewayHeaders }
  );
  return response.data.data.symbols;
}

/** Resolves ENV.PRODUCT_SYMBOL (e.g. "BTC-PERP") to its live product_id. Cached for the process lifetime. */
export async function resolveProductId(): Promise<number> {
  if (cachedProductId !== null) return cachedProductId;

  const symbols = await getSymbols();
  const info = symbols[ENV.PRODUCT_SYMBOL];
  if (!info) {
    throw new Error(
      `Symbol "${ENV.PRODUCT_SYMBOL}" not found on ${ENV.NADO_ENV}. Available: ${Object.keys(symbols).join(', ')}`
    );
  }
  if (info.trading_status !== 'live') {
    console.warn(`WARNING: ${ENV.PRODUCT_SYMBOL} trading_status is "${info.trading_status}", not "live"`);
  }

  cachedProductId = info.product_id;
  return info.product_id;
}
