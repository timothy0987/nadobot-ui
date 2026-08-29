import Link from 'next/link';

export default function Home() {
  return (
    <main className="container">
      <section className="hero">
        <h1>
          Trade smarter on the <br />
          <span className="text-gradient">Nado Orderbook</span>
        </h1>
        <p className="subtitle">
          The ultimate automated trading companion for the Nado DEX on Ink L2. Deploy powerful strategies, earn Season 2 points, and collect protocol rebates.
        </p>
        
        <div className="btn-group">
          <Link href="/dashboard" className="btn btn-primary">
            Connect Wallet
          </Link>
          <a href="https://github.com/timothy0987/nadobot" target="_blank" rel="noreferrer" className="btn btn-secondary">
            View Bot Source
          </a>
        </div>

        <div className="features-grid">
          <div className="feature-card glass">
            <div className="icon-wrapper">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>
            </div>
            <h3>High-Frequency Strategies</h3>
            <p>Our off-chain sequencer integration allows you to execute EIP-712 signed limit orders with under 15ms latency.</p>
          </div>
          
          <div className="feature-card glass">
            <div className="icon-wrapper">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
            </div>
            <h3>Season 2 Rewards</h3>
            <p>Automatically accrue points by maintaining maker liquidity and driving volume to the protocol.</p>
          </div>
          
          <div className="feature-card glass">
            <div className="icon-wrapper">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"></polygon><polyline points="2 17 12 22 22 17"></polyline><polyline points="2 12 12 17 22 12"></polyline></svg>
            </div>
            <h3>Builder Code Rebates</h3>
            <p>We automatically attach builder appendages to your orders, splitting fee rebates directly with you.</p>
          </div>
        </div>
      </section>
    </main>
  );
}
