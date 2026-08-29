import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import { ENV } from '../config/env';

export const inkChain = {
  id: ENV.CHAIN_ID,
  name: 'Ink L2',
  network: 'ink',
  nativeCurrency: {
    decimals: 18,
    name: 'Ether',
    symbol: 'ETH',
  },
  blockExplorers: {
    default: { name: 'Explorer', url: ENV.EXPLORER_URL },
  },
  rpcUrls: {
    default: {
      http: [ENV.RPC_URL],
    },
    public: {
      http: [ENV.RPC_URL],
    },
  },
};

export const publicClient = createPublicClient({
  chain: inkChain,
  transport: http(),
});

export const account = ENV.PRIVATE_KEY ? privateKeyToAccount(ENV.PRIVATE_KEY as `0x${string}`) : null;

export const walletClient = account ? createWalletClient({
  account,
  chain: inkChain,
  transport: http(ENV.RPC_URL),
}) : null;
