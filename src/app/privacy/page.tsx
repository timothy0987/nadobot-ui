import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Privacy notice · Nadobot',
  description: 'What data Nadobot uses, where it is kept, and what it never collects.',
};

const UPDATED = '16 September 2026';

export default function Privacy() {
  return (
    <main className="container doc-page">
      <header className="doc-hero">
        <span className="pill">Legal</span>
        <h1>Privacy notice</h1>
        <p className="muted">Last updated {UPDATED}</p>
      </header>

      <article className="doc legal">
        <section>
          <h2>In short</h2>
          <ul>
            <li>Nadobot has no user accounts. It never asks for your name, email, phone number or payment details.</li>
            <li>It never has access to your private keys, seed phrase or funds.</li>
            <li>It uses no advertising or tracking cookies.</li>
            <li>
              It counts anonymous usage, such as how many ladders were placed that day, with no wallet address, IP address or identifier
              attached.
            </li>
            <li>
              Almost everything it remembers stays in your own browser. Apart from those anonymous daily totals, the only data kept on a
              Nadobot server is what&apos;s needed to send push notifications, and only if you turn them on.
            </li>
          </ul>
        </section>

        <section>
          <h2>Stored in your browser</h2>
          <p>Nadobot saves these in your browser&apos;s local storage so the dashboard remembers your choices. They never leave your device:</p>
          <ul>
            <li>your network choice (testnet or mainnet), selected market, and whether you&apos;ve confirmed mainnet trading;</li>
            <li>summaries of the ladders and TWAP or DCA schedules you created, so they can be listed and cancelled;</li>
            <li>which push notification topics you chose;</li>
            <li>a note that this browser session has already been counted as a wallet session, so it is counted only once.</li>
          </ul>
          <p>
            The wallet connection library also stores your connection state locally so you stay connected. Clearing this site&apos;s data in
            your browser removes all of it.
          </p>
        </section>

        <section>
          <h2>Your wallet address and Nado data</h2>
          <p>
            When you connect a wallet, the dashboard reads your balances, positions, orders and fills directly from Nado&apos;s public
            services, from your browser. Wallet addresses and Nado trading activity are public by nature. Nado receives those requests and
            handles them under its own privacy policy.
          </p>
        </section>

        <section>
          <h2>Push notifications (only if you turn them on)</h2>
          <p>To notify you when your orders fill, Nadobot&apos;s notification service stores:</p>
          <ul>
            <li>your browser&apos;s push subscription (the delivery address and encryption keys your browser creates);</li>
            <li>your public Nado account ID and the network it&apos;s on;</li>
            <li>the topics you chose, when you subscribed, and the latest fill you were notified about, so you aren&apos;t notified twice.</li>
          </ul>
          <p>
            This is used only to send the notifications you asked for. It is deleted when you turn notifications off, or when your
            browser&apos;s push service reports that the subscription has expired. Notifications are delivered through your browser
            maker&apos;s push service (such as Google, Mozilla, Apple or Microsoft).
          </p>
        </section>

        <section>
          <h2>Anonymous usage counts</h2>
          <p>
            To see which tools are useful, the dashboard tells Nadobot&apos;s service when something is done with it, sending only three
            things:
          </p>
          <ul>
            <li>
              what happened: a wallet session started, a market order, trade plan, ladder, TWAP or DCA was placed, a position was protected, closed or
              had an exit moved, a price alert or DCA reminder was set, or a PnL card was shared;
            </li>
            <li>which network it was on (mainnet or testnet);</li>
            <li>the dollar value of the orders involved, if any.</li>
          </ul>
          <p>
            These are added to daily totals, such as &ldquo;3 ladders worth $4,200 on mainnet today&rdquo;, and kept for 180 days. No
            wallet address, account, market, IP address, cookie or identifier is sent or stored, so nothing can be traced back to you.
            The totals are public at <Link href="/stats">Nadobot in numbers</Link>. If your browser sends Do Not Track or Global
            Privacy Control, nothing is sent at all.
          </p>
        </section>

        <section>
          <h2>Hosting and service logs</h2>
          <p>
            The website is hosted on Vercel and the notification service on Railway. Like most hosts, they keep standard request logs,
            which include IP addresses, under their own privacy policies. Nadobot&apos;s service uses your IP address briefly, in memory, to
            prevent abuse, and doesn&apos;t store it.
          </p>
          <p>
            If you connect through WalletConnect, WalletConnect (Reown) relays the connection between this site and your wallet app. Your
            wallet app has its own privacy policy.
          </p>
        </section>

        <section>
          <h2>Your choices</h2>
          <ul>
            <li>Turn on Do Not Track or Global Privacy Control in your browser to stop anonymous usage counts.</li>
            <li>Disconnect your wallet at any time from the dashboard or your wallet app.</li>
            <li>Turn push notifications off in the dashboard, which deletes your subscription from the notification service.</li>
            <li>Clear this site&apos;s data in your browser settings to remove everything stored locally.</li>
          </ul>
        </section>

        <section>
          <h2>Changes</h2>
          <p>
            If what Nadobot collects changes, we&apos;ll update this notice and the date above before the change takes effect.
          </p>
        </section>

        <p className="muted">
          See also our <Link href="/terms">Terms of use</Link> and <Link href="/how-it-works">How Nadobot works</Link>.
        </p>
      </article>
    </main>
  );
}
