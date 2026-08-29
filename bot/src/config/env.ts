import dotenv from 'dotenv';

dotenv.config();

const NADO_ENV = (process.env.NADO_ENV || 'testnet').toLowerCase();
const isMainnet = NADO_ENV === 'mainnet';

const NETWORK_DEFAULTS = isMainnet
  ? {
      RPC_URL: 'https://rpc-gel.inkonchain.com',
      CHAIN_ID: 57073,
      NADO_GATEWAY_URL: 'https://gateway.prod.nado.xyz/v1',
      NADO_SUBSCRIBE_URL: 'wss://gateway.prod.nado.xyz/v1/subscribe',
      NADO_TRIGGER_URL: 'https://trigger.prod.nado.xyz/v1',
      EXPLORER_URL: 'https://explorer.inkonchain.com',
    }
  : {
      RPC_URL: 'https://rpc-gel-sepolia.inkonchain.com',
      CHAIN_ID: 763373,
      NADO_GATEWAY_URL: 'https://gateway.test.nado.xyz/v1',
      NADO_SUBSCRIBE_URL: 'wss://gateway.test.nado.xyz/v1/subscribe',
      NADO_TRIGGER_URL: 'https://trigger.test.nado.xyz/v1',
      EXPLORER_URL: 'https://explorer-sepolia.inkonchain.com',
    };

export const ENV = {
  NADO_ENV: isMainnet ? 'mainnet' : 'testnet',

  PRIVATE_KEY: process.env.PRIVATE_KEY || '',
  RPC_URL: process.env.RPC_URL || NETWORK_DEFAULTS.RPC_URL,
  CHAIN_ID: parseInt(process.env.CHAIN_ID || String(NETWORK_DEFAULTS.CHAIN_ID), 10),
  EXPLORER_URL: process.env.EXPLORER_URL || NETWORK_DEFAULTS.EXPLORER_URL,

  NADO_GATEWAY_URL: process.env.NADO_GATEWAY_URL || NETWORK_DEFAULTS.NADO_GATEWAY_URL,
  NADO_SUBSCRIBE_URL: process.env.NADO_SUBSCRIBE_URL || NETWORK_DEFAULTS.NADO_SUBSCRIBE_URL,
  NADO_TRIGGER_URL: process.env.NADO_TRIGGER_URL || NETWORK_DEFAULTS.NADO_TRIGGER_URL,

  SUBACCOUNT_NAME: process.env.SUBACCOUNT_NAME || 'default',
  PRODUCT_SYMBOL: process.env.PRODUCT_SYMBOL || 'BTC-PERP',

  BUILDER_ID: parseInt(process.env.BUILDER_ID || '0', 10),
  BUILDER_FEE_RATE_TENTH_BPS: parseInt(process.env.BUILDER_FEE_RATE_TENTH_BPS || '0', 10),

  // Entry strategy: buy when price drops this % from its recent high since the bot started.
  ENABLE_DIP_BUY: (process.env.ENABLE_DIP_BUY ?? 'true') === 'true',
  TRADE_DROP_PERCENTAGE: parseFloat(process.env.TRADE_DROP_PERCENTAGE || '0.05'),
  TRADE_AMOUNT: parseFloat(process.env.TRADE_AMOUNT || '0.001'),

  // Exit protection: whenever a position is open (however it was opened) and has no
  // active stop-loss/take-profit trigger orders, attach them automatically.
  ENABLE_POSITION_PROTECTION: (process.env.ENABLE_POSITION_PROTECTION ?? 'true') === 'true',
  STOP_LOSS_PERCENT: parseFloat(process.env.STOP_LOSS_PERCENT || '0.05'),
  TAKE_PROFIT_PERCENT: parseFloat(process.env.TAKE_PROFIT_PERCENT || '0.10'),
  PROTECTION_CHECK_INTERVAL_SECONDS: parseInt(process.env.PROTECTION_CHECK_INTERVAL_SECONDS || '30', 10),
};

if (!ENV.PRIVATE_KEY) {
  console.warn('WARNING: PRIVATE_KEY is not set in the environment.');
}

console.log(`Nado bot configured for ${ENV.NADO_ENV.toUpperCase()} (chain ${ENV.CHAIN_ID})`);
