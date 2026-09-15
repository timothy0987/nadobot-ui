import Link from 'next/link';

export default function Home() {
  return (
    <main className="container">
      <section className="hero">
        <span className="pill" style={{ marginBottom: '1.25rem' }}>Independent tool · not affiliated with Nado</span>
        <h1>
          Keep trading on Nado <br />
          <span className="text-gradient">while you&apos;re offline</span>
        </h1>
        <p className="subtitle">
          Set your entry, stop-loss and take-profit once. Nadobot turns them into orders that run on Nado while you&apos;re offline, signed by your own wallet, so no one else ever holds your keys.
        </p>
        
        <div className="btn-group">
          <Link href="/dashboard" className="btn btn-primary">
            Launch App
          </Link>
          <Link href="/how-it-works" className="btn btn-secondary">
            How it works
          </Link>
        </div>

        <div className="features-grid">
          <div className="feature-card glass">
            <div className="icon-wrapper">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>
            </div>
            <h3>Trade while offline</h3>
            <p>Trade plans live on Nado&apos;s own servers: your entry rests on the orderbook, and your exits wake up the moment it fills.</p>
          </div>
          
          <div className="feature-card glass">
            <div className="icon-wrapper">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
            </div>
            <h3>Never custodial</h3>
            <p>Every order is signed in your wallet. Nadobot never holds a key that can move or withdraw your funds.</p>
          </div>
          
          <div className="feature-card glass">
            <div className="icon-wrapper">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"></polygon><polyline points="2 17 12 22 22 17"></polyline><polyline points="2 12 12 17 22 12"></polyline></svg>
            </div>
            <h3>Protection built in</h3>
            <p>Every plan comes with a stop-loss and take-profit, and cancelling the entry cancels its exits automatically.</p>
          </div>
        </div>
      </section>
    </main>
  );
}
