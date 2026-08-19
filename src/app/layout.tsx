import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Nadobot - Professional Nado Trading Bot',
  description: 'Deploy a high-performance CLOB trading bot on the Nado DEX (Ink L2). Accrue Season 2 points and builder fees.',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>
        <nav className="container navbar">
          <div className="logo">
            <span className="text-gradient">Nado</span>bot
          </div>
          <div>
            <a href="/dashboard" className="btn btn-secondary" style={{ padding: '0.5rem 1rem', fontSize: '0.9rem' }}>
              Launch App
            </a>
          </div>
        </nav>
        {children}
      </body>
    </html>
  )
}
