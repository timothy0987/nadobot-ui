import WebSocket from 'ws';
import { ENV } from '../config/env';

export interface TradeEvent {
  type: 'trade';
  product_id: number;
  price: string; // x18-scaled
  taker_qty: string;
  is_taker_buyer: boolean;
}

const PING_INTERVAL_MS = 25_000;

export function startPriceFeedListener(productId: number, onTrade: (event: TradeEvent) => void) {
  const ws = new WebSocket(ENV.NADO_SUBSCRIBE_URL, { perMessageDeflate: true });
  let pingTimer: ReturnType<typeof setInterval>;

  ws.on('open', () => {
    console.log(`Connected to Nado subscriptions: ${ENV.NADO_SUBSCRIBE_URL}`);
    ws.send(JSON.stringify({ method: 'subscribe', stream: { type: 'trade', product_id: productId }, id: 1 }));
    pingTimer = setInterval(() => ws.ping(), PING_INTERVAL_MS); // required every 30s per Nado docs
  });

  ws.on('message', (data: WebSocket.RawData) => {
    try {
      const parsed = JSON.parse(data.toString());
      if (parsed.type === 'trade') onTrade(parsed as TradeEvent);
    } catch (e) {
      console.error('Error parsing WS message', e);
    }
  });

  ws.on('close', () => {
    clearInterval(pingTimer);
    console.log('WebSocket disconnected. Attempting to reconnect in 5s...');
    setTimeout(() => startPriceFeedListener(productId, onTrade), 5000);
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
    ws.close();
  });
}

/** Converts an x18-scaled price string from the feed into a plain JS number. */
export function priceX18ToNumber(priceX18: string): number {
  return Number(BigInt(priceX18)) / 1e18;
}
