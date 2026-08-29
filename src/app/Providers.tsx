'use client';

import '@rainbow-me/rainbowkit/styles.css';
import { getDefaultConfig, RainbowKitProvider, darkTheme } from '@rainbow-me/rainbowkit';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const inkSepolia = {
  id: 763373,
  name: 'Ink Sepolia (Testnet)',
  iconUrl: 'https://nadoexplorer.com/favicon.ico',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc-gel-sepolia.inkonchain.com'] },
  },
  blockExplorers: {
    default: { name: 'Ink Sepolia Explorer', url: 'https://explorer-sepolia.inkonchain.com' },
  },
  testnet: true,
} as const;

const inkMainnet = {
  id: 57073,
  name: 'Ink L2',
  iconUrl: 'https://nadoexplorer.com/favicon.ico',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc-gel.inkonchain.com'] },
  },
  blockExplorers: {
    default: { name: 'Ink Explorer', url: 'https://explorer.inkonchain.com' },
  },
} as const;

// Testnet listed first: this dashboard defaults to Nado testnet while the bot is being validated.
const config = getDefaultConfig({
  appName: 'Nadobot Dashboard',
  projectId: '1f440a349bc9842f1fbf8efdb286dfdb', // Demo project ID
  chains: [inkSepolia, inkMainnet],
  ssr: true,
});

const queryClient = new QueryClient();

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={darkTheme({
          accentColor: '#10b981',
          accentColorForeground: 'white',
          borderRadius: 'large',
          fontStack: 'system',
        })}>
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
