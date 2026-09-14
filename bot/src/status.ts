import http from 'http';
import { ENV } from './config/env';
import { botState } from './state';

/**
 * Read-only JSON status for the dashboard. Deliberately exposes nothing secret: only public on-chain
 * facts (address, position) and the non-sensitive strategy settings.
 */
export function startStatusServer(botAddress: string, subaccount: string) {
  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    if (req.method === 'OPTIONS') {
      res.writeHead(204).end();
      return;
    }
    if (req.method !== 'GET' || (req.url !== '/status' && req.url !== '/')) {
      res.writeHead(404, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'not found' }));
      return;
    }

    const body = {
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
        protectionEnabled: ENV.ENABLE_POSITION_PROTECTION,
        stopLossPercent: ENV.STOP_LOSS_PERCENT * 100,
        takeProfitPercent: ENV.TAKE_PROFIT_PERCENT * 100,
      },
      ...botState,
      entryTriggerPrice: botState.sessionHigh ? botState.sessionHigh * (1 - ENV.TRADE_DROP_PERCENTAGE) : null,
      alertsConfigured: Boolean((ENV.TELEGRAM_BOT_TOKEN && ENV.TELEGRAM_CHAT_ID) || ENV.DISCORD_WEBHOOK_URL),
    };
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
  });

  server.listen(ENV.PORT, () => console.log(`Status endpoint listening on :${ENV.PORT}/status`));
  return server;
}
