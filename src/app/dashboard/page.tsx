import Link from 'next/link';

export default function Dashboard() {
  return (
    <main className="container" style={{ paddingTop: '2rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <div>
          <h2>Dashboard</h2>
          <p className="text-secondary">Overview of your active Nadobot instance.</p>
        </div>
        <button className="btn btn-primary" style={{ padding: '0.5rem 1rem' }}>Connect Wallet</button>
      </div>

      <div className="dashboard-grid">
        <div className="feature-card glass">
          <div className="stat-label">Season 2 Points</div>
          <div className="stat-value text-gradient">24,590</div>
          <div className="stat-sub">↑ 1,200 points this week</div>
        </div>
        
        <div className="feature-card glass">
          <div className="stat-label">Builder Rebates Earned</div>
          <div className="stat-value text-gradient">145.50 USDC</div>
          <div className="stat-sub">Paid to connected wallet</div>
        </div>

        <div className="feature-card glass">
          <div className="stat-label">Bot Health Ratio</div>
          <div className="stat-value" style={{ color: 'var(--success)' }}>100%</div>
          <div className="stat-sub">Operational & Healthy</div>
        </div>
      </div>

      <div className="glass" style={{ padding: '2rem', marginTop: '2rem' }}>
        <h3>Active Strategy Configuration</h3>
        <div style={{ marginTop: '1.5rem', display: 'grid', gap: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--glass-border)', paddingBottom: '0.5rem' }}>
            <span style={{ color: 'var(--text-secondary)' }}>Market</span>
            <span>WETH-USDC Perp</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--glass-border)', paddingBottom: '0.5rem' }}>
            <span style={{ color: 'var(--text-secondary)' }}>Trade Drop Trigger</span>
            <span>5.00%</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--glass-border)', paddingBottom: '0.5rem' }}>
            <span style={{ color: 'var(--text-secondary)' }}>Order Amount</span>
            <span>1.0 WETH</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--glass-border)', paddingBottom: '0.5rem' }}>
            <span style={{ color: 'var(--text-secondary)' }}>Status</span>
            <span style={{ color: 'var(--success)' }}>Listening on wss://gateway.prod.nado.xyz/v1/ws</span>
          </div>
        </div>
      </div>
    </main>
  );
}
