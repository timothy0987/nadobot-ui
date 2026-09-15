import http from 'http';
import { ENV } from './config/env';
import { botState } from './state';
import { parseSubscribe, isAllowedPushEndpoint } from './push/validate';
import { pushPublicKey, subscribe, unsubscribe, pushSubscriptionCount } from './push/service';

const MAX_BODY_BYTES = 16 * 1024;
const WRITES_PER_MINUTE = 30;
const writesByIp = new Map<string, { windowStart: number; count: number }>();

function rateLimited(ip: string) {
  const now = Date.now();
  if (writesByIp.size > 5000) for (const [k, v] of writesByIp) if (now - v.windowStart > 60_000) writesByIp.delete(k);
  const entry = writesByIp.get(ip);
  if (!entry || now - entry.windowStart > 60_000) {
    writesByIp.set(ip, { windowStart: now, count: 1 });
    return false;
  }
  entry.count++;
  return entry.count > WRITES_PER_MINUTE;
}

function readJson(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Body too large'));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

const send = (res: http.ServerResponse, status: number, body: unknown) =>
  res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));

/**
 * The dashboard's API: read-only status (only public on-chain facts and non-sensitive settings) plus push
 * subscription management. Nothing here can place orders or reveal keys.
 */
export function startStatusServer(botAddress: string, subaccount: string) {
  const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    const url = (req.url ?? '/').split('?')[0];

    if (req.method === 'OPTIONS') return void res.writeHead(204).end();

    if (req.method === 'GET' && (url === '/status' || url === '/')) {
      return send(res, 200, {
        network: ENV.NADO_ENV,
        chainId: ENV.CHAIN_ID,
        botAddress,
        subaccount,
        product: ENV.PRODUCT_SYMBOL,
        strategy: {
          dipBuyEnabled: ENV.ENABLE_DIP_BUY,
          entryDropPercent: ENV.TRADE_DROP_PERCENTAGE * 100,
          tradeAmount: ENV.TRADE_AMOUNT,
          maxPositionSize: ENV.MAX_POSITION_SIZE,
          tradingPaused: ENV.TRADING_PAUSED,
          dailyLossLimitUsd: ENV.DAILY_LOSS_LIMIT_USD,
          protectionEnabled: ENV.ENABLE_POSITION_PROTECTION,
          stopLossPercent: ENV.STOP_LOSS_PERCENT * 100,
          takeProfitPercent: ENV.TAKE_PROFIT_PERCENT * 100,
        },
        ...botState,
        entryTriggerPrice: botState.sessionHigh ? botState.sessionHigh * (1 - ENV.TRADE_DROP_PERCENTAGE) : null,
        pushSubscriptions: pushSubscriptionCount(),
      });
    }

    if (req.method === 'GET' && url === '/push/public-key') {
      const publicKey = pushPublicKey();
      return publicKey ? send(res, 200, { publicKey, chainId: ENV.CHAIN_ID, network: ENV.NADO_ENV }) : send(res, 503, { error: 'Push unavailable' });
    }

    if (req.method === 'POST' && (url === '/push/subscribe' || url === '/push/unsubscribe')) {
      const ip = String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '').split(',')[0].trim();
      if (rateLimited(ip)) return send(res, 429, { error: 'Too many requests' });
      try {
        const body = await readJson(req);
        if (url === '/push/unsubscribe') {
          if (!isAllowedPushEndpoint(body?.endpoint)) return send(res, 400, { error: 'Unsupported push endpoint' });
          unsubscribe(body.endpoint);
          return send(res, 200, { ok: true });
        }
        const input = parseSubscribe(body);
        if ('error' in input) return send(res, 400, input);
        await subscribe(input);
        return send(res, 200, { ok: true });
      } catch (e: any) {
        return send(res, 400, { error: e.message });
      }
    }

    send(res, 404, { error: 'not found' });
  });

  server.listen(ENV.PORT, () => console.log(`Status endpoint listening on :${ENV.PORT}/status`));
  return server;
}
