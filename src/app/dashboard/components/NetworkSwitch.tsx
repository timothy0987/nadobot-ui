'use client';

import { useEffect, useState } from 'react';
import { useAccount, useSwitchChain } from 'wagmi';
import { INK_MAINNET, INK_SEPOLIA, NETWORKS, type NadoNetwork } from '@/lib/nado';

const PREFERRED_KEY = 'nadobot:network';
const MAINNET_ACK_KEY = 'nadobot:mainnet-ack-v2';

const readStorage = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const writeStorage = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {}
};

/**
 * Which Nado network the dashboard shows and signs for. A connected wallet on a supported chain decides it;
 * otherwise the last network the user picked. Orders must be signed on the chain they trade on, so a wallet on
 * any other chain is reported as unsupported and signing is disabled.
 */
export function useDashboardNetwork() {
  const { isConnected, chainId: walletChainId } = useAccount();
  const { switchChainAsync, isPending } = useSwitchChain();
  const [preferred, setPreferred] = useState(INK_SEPOLIA.chainId);
  const [switchError, setSwitchError] = useState<string | null>(null);

  useEffect(() => {
    const saved = Number(readStorage(PREFERRED_KEY));
    if (NETWORKS[saved]) setPreferred(saved);
  }, []);

  const walletNetwork = walletChainId ? NETWORKS[walletChainId] : undefined;
  const network: NadoNetwork = isConnected && walletNetwork ? walletNetwork : NETWORKS[preferred];
  const onSupportedChain = !isConnected || Boolean(walletNetwork);

  const select = async (chainId: number) => {
    setSwitchError(null);
    setPreferred(chainId);
    writeStorage(PREFERRED_KEY, String(chainId));
    if (isConnected && walletChainId !== chainId) {
      try {
        await switchChainAsync({ chainId });
      } catch (e: any) {
        setSwitchError(e?.shortMessage ?? 'Your wallet did not switch networks.');
      }
    }
  };

  return { network, onSupportedChain, select, switching: isPending, switchError };
}

export function NetworkSwitch({ network, select, switching }: { network: NadoNetwork; select: (chainId: number) => void; switching: boolean }) {
  return (
    <div className="segmented" role="radiogroup" aria-label="Network">
      {[INK_SEPOLIA, INK_MAINNET].map((n) => {
        const active = n.chainId === network.chainId;
        return (
          <button
            key={n.chainId}
            role="radio"
            aria-checked={active}
            className={`segment ${active ? 'active' : ''} ${n === INK_MAINNET ? 'mainnet' : ''}`}
            onClick={() => select(n.chainId)}
            disabled={switching}
          >
            {n === INK_MAINNET ? 'Mainnet' : 'Testnet'}
          </button>
        );
      })}
    </div>
  );
}

/** On mainnet, order forms stay hidden until the trader confirms they understand orders use real funds. */
export function MainnetGate({ network, children }: { network: NadoNetwork; children: React.ReactNode }) {
  const [acknowledged, setAcknowledged] = useState<boolean | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => setAcknowledged(readStorage(MAINNET_ACK_KEY) === '1'), []);

  if (network.chainId !== INK_MAINNET.chainId) return <>{children}</>;
  if (acknowledged === null) return null;

  if (!acknowledged) {
    return (
      <div className="glass panel mainnet-warning">
        <h3>You&apos;re on Nado mainnet</h3>
        <p className="muted" style={{ marginTop: '0.5rem', maxWidth: 680 }}>
          Orders you sign here trade <strong>real funds</strong> on Nado. Stop-losses can fill below their trigger price in fast
          markets, and TWAP executions can fill anywhere within your slippage limit. Nadobot is an independent tool, not
          affiliated with Nado, and never holds your keys: you sign every order yourself.
        </p>
        <label style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', marginTop: '1.25rem' }}>
          <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
          <span>
            I understand these orders use real funds, I&apos;m responsible for them, and I accept the{' '}
            <a href="/terms" target="_blank" rel="noreferrer" style={{ textDecoration: 'underline' }}>
              Terms of use
            </a>
            .
          </span>
        </label>
        <div className="form-row">
          <button
            className="btn btn-primary btn-sm"
            disabled={!checked}
            onClick={() => {
              writeStorage(MAINNET_ACK_KEY, '1');
              setAcknowledged(true);
            }}
          >
            Continue to mainnet trading
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="notice mainnet-banner">Mainnet: orders use real funds.</div>
      {children}
    </>
  );
}
