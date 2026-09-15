import type { Metadata } from 'next'
import './globals.css'
import { Providers } from './Providers'

export const metadata: Metadata = {
  title: 'Nadobot · Independent trade automation for Nado',
  description:
    'Nadobot is an independent tool for trading on Nado. Not affiliated with or endorsed by Nado. It never asks for token approvals or transfers.',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <nav className="container navbar">
            <a href="/" className="logo">
              Nadobot
              <span className="pill">Built on Nado</span>
            </a>
            <div className="nav-links">
              <a href="/how-it-works" className="nav-link">
                How it works
              </a>
              <a href="/dashboard" className="btn btn-secondary" style={{ padding: '0.5rem 1rem', fontSize: '0.9rem' }}>
                Launch App
              </a>
            </div>
          </nav>
          {children}
          <footer className="container site-footer">
            <p>
              <strong>Nadobot is an independent tool.</strong> It is built on Nado&apos;s public API and is not affiliated
              with, endorsed by, or operated by Nado. The official Nado app is at{' '}
              <a href="https://app.nado.xyz" target="_blank" rel="noreferrer">
                app.nado.xyz
              </a>
              .
            </p>
            <p>
              Nadobot never asks for token approvals, transfers, or on-chain transactions. The only wallet requests are signed
              messages for Nado (<code>Order</code>, <code>Cancellation</code>, <code>ListTriggerOrders</code>). Reject anything else.{' '}
              <a href="/how-it-works">How Nadobot works</a>
            </p>
          </footer>
        </Providers>
      </body>
    </html>
  )
}
