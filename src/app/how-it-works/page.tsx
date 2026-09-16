import type { Metadata } from 'next';
import Link from 'next/link';
import { BUILDER_FEE_RATE_TENTH_BPS } from '@/lib/nado';

export const metadata: Metadata = {
  title: 'How Nadobot works · Independent trade automation for Nado',
  description:
    'A guide to Nadobot: trade plans, ladders, TWAP and DCA, position protection, portfolio and alerts, all signed by your own wallet and run on Nado.',
};

const SECTIONS = [
  { id: 'overview', label: 'What Nadobot is' },
  { id: 'getting-started', label: 'Getting started' },
  { id: 'offline', label: 'How orders run offline' },
  { id: 'signatures', label: 'What you sign' },
  { id: 'risk-checks', label: 'Risk checks & sizing' },
  { id: 'trade-plans', label: 'Trade plans' },
  { id: 'ladders', label: 'Ladders & scaled take-profits' },
  { id: 'twap-dca', label: 'TWAP & DCA' },
  { id: 'protect', label: 'Protect a position' },
  { id: 'orders', label: 'My orders' },
  { id: 'portfolio', label: 'Portfolio' },
  { id: 'alerts', label: 'Alerts & notifications' },
  { id: 'limits', label: 'Rules & limits' },
  { id: 'fees', label: 'Fees' },
  { id: 'risks', label: 'Risks' },
  { id: 'faq', label: 'FAQ' },
];

export default function HowItWorks() {
  const builderFeeBps = BUILDER_FEE_RATE_TENTH_BPS / 10;

  return (
    <main className="container doc-page">
      <header className="doc-hero">
        <span className="pill">Guide</span>
        <h1>How Nadobot works</h1>
        <p className="subtitle">
          Nadobot turns your trading ideas into orders that run on Nado while you&apos;re away. You sign every order in your own
          wallet, and Nado executes it. Nadobot never holds your keys or your funds.
        </p>
        <div className="btn-group">
          <Link href="/dashboard" className="btn btn-primary">
            Launch App
          </Link>
          <a href="#getting-started" className="btn btn-secondary">
            Get started
          </a>
        </div>
      </header>

      <div className="doc-layout">
        <nav className="doc-toc" aria-label="On this page">
          <p className="doc-toc-title">On this page</p>
          <ol>
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`}>{s.label}</a>
              </li>
            ))}
          </ol>
        </nav>

        <article className="doc">
          <section id="overview">
            <h2>What Nadobot is</h2>
            <p>
              <a href="https://app.nado.xyz" target="_blank" rel="noreferrer">
                Nado
              </a>{' '}
              is an orderbook exchange for spot and perpetual futures on Ink. Nadobot is an independent tool built on Nado&apos;s public
              API. It adds automation Nado traders often want: entries with their exits attached, laddered entries, orders spread over
              time, protection for open positions, and a clear view of your PnL and volume.
            </p>
            <p>
              Nadobot is <strong>not affiliated with, endorsed by, or operated by Nado</strong>. Your account, balances and positions are
              on Nado; Nadobot is only a different way to place and follow orders on it.
            </p>
          </section>

          <section id="getting-started">
            <h2>Getting started</h2>
            <ol className="doc-steps">
              <li>
                <strong>Open the dashboard</strong> with <Link href="/dashboard">Launch App</Link> and connect an EVM wallet (MetaMask,
                Rabby, WalletConnect and others).
              </li>
              <li>
                <strong>Pick a network</strong> at the top: <em>Testnet</em> (Ink Sepolia, practice funds) or <em>Mainnet</em> (Ink, real
                funds). Your wallet will be asked to switch chains. We recommend trying every tool on testnet first.
              </li>
              <li>
                <strong>Have a Nado account on that network.</strong> Deposit at least $5 USDT0 on{' '}
                <a href="https://app.nado.xyz" target="_blank" rel="noreferrer">
                  app.nado.xyz
                </a>{' '}
                for mainnet, or use{' '}
                <a href="https://testnet.nado.xyz/portfolio/faucet" target="_blank" rel="noreferrer">
                  Nado&apos;s testnet faucet
                </a>
                . Deposits and withdrawals always happen on Nado itself, never in Nadobot.
              </li>
              <li>
                <strong>Choose a market</strong>: every perpetual market Nado currently trades is available (search by name), then pick
                a tool. On mainnet you&apos;ll confirm once that orders use
                real funds.
              </li>
              <li>
                <strong>Review and sign.</strong> Every tool shows exactly what will be placed and checks it against Nado&apos;s rules before
                your wallet opens.
              </li>
            </ol>
          </section>

          <section id="offline">
            <h2>How orders run while you&apos;re offline</h2>
            <div className="flow" role="list">
              <div className="flow-step" role="listitem">
                <span className="flow-num">1</span>
                <strong>You sign</strong>
                <p>Your wallet signs each order as a message. Nothing is sent on-chain and no gas is spent.</p>
              </div>
              <div className="flow-arrow" aria-hidden>
                →
              </div>
              <div className="flow-step" role="listitem">
                <span className="flow-num">2</span>
                <strong>Nado stores it</strong>
                <p>Limit orders rest on Nado&apos;s orderbook. Stop-losses, take-profits and TWAPs wait on Nado&apos;s trigger service.</p>
              </div>
              <div className="flow-arrow" aria-hidden>
                →
              </div>
              <div className="flow-step" role="listitem">
                <span className="flow-num">3</span>
                <strong>Nado executes</strong>
                <p>When the price or time condition is met, Nado fills the order, whether your browser is open or not.</p>
              </div>
            </div>
            <p>
              Because the orders live on Nado&apos;s servers, closing the dashboard, turning off your computer or losing connection changes
              nothing. Nadobot doesn&apos;t need to be running for your orders to work.
            </p>
          </section>

          <section id="signatures">
            <h2>What you sign (and never sign)</h2>
            <p>Nadobot only ever asks your wallet to sign three kinds of Nado message:</p>
            <ul>
              <li>
                <code>Order</code>: places one order (entry, stop-loss, take-profit, ladder entry or TWAP).
              </li>
              <li>
                <code>Cancellation</code>: cancels orders you choose.
              </li>
              <li>
                <code>ListTriggerOrders</code>: lets you view your own conditional orders, which Nado keeps private.
              </li>
            </ul>
            <div className="callout warn">
              <strong>Nadobot never asks for token approvals, transfers, deposits, withdrawals or any on-chain transaction.</strong> If a
              wallet prompt asks for any of those while you&apos;re on a site that looks like Nadobot, reject it.
            </div>
            <p>
              Each order needs its own signature, so tools that place several orders ask you to sign several times. The alternative would
              be giving a shared bot key permission over your account, and on Nado such a key could also withdraw funds. Nadobot
              doesn&apos;t do that.
            </p>
          </section>

          <section id="risk-checks">
            <h2>Risk checks &amp; sizing</h2>
            <p className="doc-lead">Before you sign, every order shows what it would do to your account if it fully fills.</p>
            <ul>
              <li>
                <strong>Estimated liquidation price</strong>, next to the current one if you already hold a position.
              </li>
              <li>
                <strong>Account leverage</strong> before and after, and how much of your margin the trade would use.
              </li>
              <li>
                <strong>Blocked before signing</strong>: orders that need more margin than your account has, and stop-losses placed beyond the
                liquidation price, where you could be liquidated before the stop fires.
              </li>
              <li>
                <strong>Warnings</strong> when liquidation would be within 10% of the current price, or leverage would reach 10x or more.
              </li>
            </ul>
            <p>
              <strong>Size by risk.</strong> In trade plans and ladders you can choose how to size an order: an amount in USD, an amount in
              the coin, or <em>Risk</em>, the most you&apos;re willing to lose. With Risk, Nadobot works out the size so that hitting the
              stop-loss loses about that amount, before fees.
            </p>
            <div className="callout">
              These are estimates using Nado&apos;s own margin rules. They assume only this market&apos;s price moves, judge margin at your
              order&apos;s fill price, and leave out fees and funding. Nado&apos;s live numbers always take priority.
            </div>
          </section>

          <section id="trade-plans">
            <h2>Trade plans</h2>
            <p className="doc-lead">One entry price with a stop-loss and take-profit attached. Three signatures.</p>
            <ul>
              <li>
                <strong>Entry</strong>: a limit order that rests on the orderbook at your price. It must be below the market for a long
                (above for a short), so it waits for the price instead of filling instantly.
              </li>
              <li>
                <strong>Stop-loss and take-profit</strong>: set as a percentage from the entry. They stay dormant until the entry fills,
                then activate automatically (even on a partial fill).
              </li>
              <li>
                <strong>Size</strong>: in USD, in the coin, or by risk (the most you&apos;d lose at the stop-loss).
              </li>
              <li>
                <strong>Expiry</strong>: the entry expires after the number of days you choose (7 by default). Cancelling the entry also
                cancels its exits.
              </li>
            </ul>
          </section>

          <section id="ladders">
            <h2>Ladders &amp; scaled take-profits</h2>
            <p className="doc-lead">
              Build a position across several prices instead of one, then take profit in steps. One signature per order.
            </p>
            <ul>
              <li>
                <strong>Entries</strong>: 1 to 10 limit orders evenly spaced between a first and last price. <em>Even</em> puts the same
                size on each; <em>Weighted</em> puts more size on the better prices. Size the whole ladder in USD, in the coin, or by risk.
              </li>
              <li>
                <strong>One stop-loss</strong> for the whole ladder, set as a percentage from the average entry. It must sit beyond your
                last entry so it can&apos;t close the position before the ladder has filled.
              </li>
              <li>
                <strong>Up to 4 take-profit targets</strong>, each a distance from the average entry plus the share of the position it
                closes. Shares add up to 100%.
              </li>
              <li>
                <strong>Preview</strong>: every order, your average entry, the loss if the stop is hit and the profit if every target is
                hit, before fees.
              </li>
              <li>
                <strong>Order of placement</strong>: the first entry, then the stop-loss and targets, then the remaining entries. Exits
                wait for the first entry to fill; price always reaches it before the deeper ones.
              </li>
            </ul>
            <div className="callout">
              Exits are sized for the full ladder but can only reduce your position. If only part of the ladder fills, the first target
              may close all of it, and no exit can ever open a position in the other direction.
            </div>
            <p>
              If you reject a signature partway, the dashboard offers <em>Roll back</em> to cancel what was already placed. Under{' '}
              <em>Your ladders</em> you can see how many entries are still waiting and choose <em>Cancel unfilled entries</em> (keeps the
              exits protecting what filled) or <em>Cancel entries and exits</em>.
            </p>
          </section>

          <section id="twap-dca">
            <h2>TWAP &amp; DCA</h2>
            <p className="doc-lead">Split one order into many smaller ones over time. One signature for the whole schedule.</p>
            <ul>
              <li>
                <strong>TWAP</strong>: a number of executions spread evenly over the minutes you choose, to reduce price impact on large
                orders.
              </li>
              <li>
                <strong>DCA</strong>: buy or sell a fixed amount every 15 minutes to 4 hours, for up to 24 hours per schedule.
              </li>
              <li>
                <strong>Price protection</strong>: every execution respects a maximum slippage (0.5% by default) and a hard limit:
                &ldquo;never buy above&rdquo; or &ldquo;never sell below&rdquo; (3% from the current price by default).
              </li>
              <li>
                <strong>Progress</strong>: executions done, the next scheduled time and any failed execution show under the form, and
                you can cancel the rest at any time.
              </li>
            </ul>
            <p>
              Nado limits a schedule to 25 hours, so a longer DCA plan means starting a new schedule each day. Tick{' '}
              <em>Remind me when it ends</em> and Nadobot sends a notification when the schedule finishes. Tapping it opens the
              dashboard with the same DCA filled in, ready for one signature. There&apos;s no reminder if you cancelled the schedule
              yourself.
            </p>
          </section>

          <section id="protect">
            <h2>Protect a position</h2>
            <p>
              Already holding a position, opened on Nado or anywhere else? <em>Protect open position</em> attaches a stop-loss and a
              take-profit, set as percentages from your average entry, with two signatures. They only reduce the position and keep
              working on Nado while you&apos;re offline. Check <em>My orders</em> first so you don&apos;t stack duplicate protection.
            </p>
          </section>

          <section id="orders">
            <h2>My orders</h2>
            <p>
              Lists your resting limit orders and your conditional orders (stop-losses, take-profits, TWAPs) for the selected market,
              with their status: waiting for the entry to fill, watching the price, or executing. Loading them takes one signature,
              because Nado only shows conditional orders to their owner. Cancelling an order asks for a cancellation signature.
            </p>
            <p>
              Orders from a ladder are labelled (&ldquo;Ladder entry 1 of 4&rdquo;), and cancelling a ladder&apos;s first entry here
              cancels the whole ladder, so the deeper entries are never left without their stop.
            </p>
            <p>
              <strong>Move a stop-loss or take-profit</strong> with the <em>Move</em> button: type a new level and Nadobot re-places it
              there. It takes two signatures, and the new one is placed before the old one is cancelled, so your position is never left
              unprotected in between. A level the market has already passed is refused, since it would fire straight away.
            </p>
          </section>

          <section id="portfolio">
            <h2>Portfolio</h2>
            <p>Your trading on Nado across every market, including trades made outside Nadobot. It needs no signature.</p>
            <ul>
              <li>
                <strong>Open positions</strong> at Nado&apos;s mark price: entry, value, unrealized PnL and funding.
              </li>
              <li>
                <strong>Close or trim</strong>: close 25%, 50% or all of any position at the current price, in one signature. You confirm the
                exact size and the worst price it can fill at first. The order can only reduce the position, and is cancelled if it
                can&apos;t fill within 1% of the market.
              </li>
              <li>
                <strong>History</strong> of closed positions: entry and exit prices, time held, fees plus funding, and net PnL.
              </li>
              <li>
                <strong>Share a trade</strong>: turn any closed position into an image showing its net return, to post on X,
                Telegram or anywhere else. Dollar amounts are hidden unless you choose to show them.
              </li>
              <li>
                <strong>24h, 7d and 30d</strong>: realized PnL after fees, volume, number of fills and maker share, lifetime volume, and
                a chart of volume with cumulative PnL.
              </li>
            </ul>
          </section>

          <section id="alerts">
            <h2>Alerts &amp; notifications</h2>
            <ul>
              <li>
                <strong>In-app alerts</strong> pop up while the dashboard is open when your orders fill.
              </li>
              <li>
                <strong>Price alerts</strong>: ask to be told when a market reaches a price. Nadobot watches it for you and the
                notification opens the dashboard on that market, ready to trade. Alerts belong to the device, need no wallet, and fire
                once.
              </li>
              <li>
                <strong>Push notifications</strong> reach your device even with the dashboard closed. Turn them on in the dashboard and
                allow notifications in your browser. On iPhone or iPad, first add the dashboard to your Home Screen (Share → Add to Home
                Screen) and open it from there.
              </li>
            </ul>
            <p className="muted">
              To send push notifications, Nadobot&apos;s notification service stores your browser&apos;s push subscription and your
              public Nado account ID, which it uses to watch for fills. It never receives your keys. Turning notifications off deletes the
              subscription. See the <Link href="/privacy">Privacy notice</Link> for details.
            </p>
          </section>

          <section id="limits">
            <h2>Rules &amp; limits</h2>
            <p>The dashboard checks these before you sign, so an order that would be rejected or fail later never gets signed.</p>
            <div className="table-scroll">
              <table className="data-table doc-table">
                <thead>
                  <tr>
                    <th>Rule</th>
                    <th>Limit</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Minimum order value</td>
                    <td>Set per market by Nado ($100 on BTC-PERP). Applies to every entry, TWAP execution and take-profit step.</td>
                  </tr>
                  <tr>
                    <td>Price and size steps</td>
                    <td>Prices and sizes are rounded to the market&apos;s tick and lot size, never to a worse price.</td>
                  </tr>
                  <tr>
                    <td>Stop-loss and take-profit execution</td>
                    <td>Triggered by the last traded price; fills up to 0.5% past the trigger price.</td>
                  </tr>
                  <tr>
                    <td>Entry expiry</td>
                    <td>Your choice, 7 days by default. Exits stay valid for 30 days after that.</td>
                  </tr>
                  <tr>
                    <td>Margin</td>
                    <td>Orders that would need more margin than your account has, or a stop-loss beyond the liquidation price, can&apos;t be signed.</td>
                  </tr>
                  <tr>
                    <td>Ladders</td>
                    <td>Up to 10 entries and 4 take-profit steps.</td>
                  </tr>
                  <tr>
                    <td>TWAP / DCA</td>
                    <td>1 to 500 executions, finishing within 25 hours, max slippage up to 10%.</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section id="fees">
            <h2>Fees</h2>
            <p>
              Nado&apos;s normal trading fees apply to every fill, exactly as on Nado&apos;s own app.{' '}
              {builderFeeBps > 0 ? (
                <>
                  Nadobot adds a builder fee of <strong>{builderFeeBps} bps ({(builderFeeBps / 100).toFixed(3)}%)</strong> of the value of
                  each filled order placed through it, collected by Nado as part of the trade. Unfilled or cancelled orders cost nothing.
                </>
              ) : (
                <>
                  <strong>Nadobot currently charges no fee of its own.</strong> If that changes, it will be a small builder fee collected by
                  Nado on filled orders only, shown here and before you sign.
                </>
              )}
            </p>
            <p>Signing orders is free: nothing is sent on-chain, so there is no gas.</p>
          </section>

          <section id="risks">
            <h2>Risks to know</h2>
            <ul>
              <li>
                <strong>Stops aren&apos;t guaranteed.</strong> In a fast market a stop-loss or take-profit can fill only partly, or not at
                all, if the price moves more than 0.5% past the trigger. Check <em>Portfolio</em> and <em>My orders</em> after big moves.
              </li>
              <li>
                <strong>Leverage and liquidation.</strong> Nado&apos;s margin rules always apply. The liquidation price shown is an
                estimate: other positions, funding and fees move it, and a stop-loss doesn&apos;t prevent liquidation if your account runs
                out of margin first.
              </li>
              <li>
                <strong>Partial fills.</strong> A ladder may only partly fill, and a TWAP or DCA execution that can&apos;t fill within your
                limits is skipped.
              </li>
              <li>
                <strong>Independent software.</strong> Nadobot is provided as is. Start small, try tools on testnet first, and never
                trade more than you can afford to lose. Nothing here is financial advice. Using Nadobot means you accept the{' '}
                <Link href="/terms">Terms of use</Link>.
              </li>
            </ul>
          </section>

          <section id="faq">
            <h2>FAQ</h2>
            <details>
              <summary>Do I need to keep the dashboard open?</summary>
              <p>No. Once signed, your orders live on Nado and execute on their own.</p>
            </details>
            <details>
              <summary>Can Nadobot move or withdraw my funds?</summary>
              <p>
                No. Nadobot never has a key to your account and never asks for approvals, transfers or withdrawals. It can only submit
                orders you have signed.
              </p>
            </details>
            <details>
              <summary>Why does a ladder ask for so many signatures?</summary>
              <p>
                Nado needs a separate signature for each order. A 4-entry ladder with 3 take-profit targets is 8 orders: 4 entries, 1
                stop-loss and 3 targets.
              </p>
            </details>
            <details>
              <summary>Why does loading &ldquo;My orders&rdquo; ask me to sign?</summary>
              <p>
                Nado keeps conditional orders private. The signature proves you own the account; it can&apos;t place, cancel or move
                anything.
              </p>
            </details>
            <details>
              <summary>I switched devices. Where are my ladders and schedules?</summary>
              <p>
                The orders are on Nado and show under <em>My orders</em> and <em>Portfolio</em> on any device. The <em>Your ladders</em>{' '}
                and <em>Your schedules</em> summaries are remembered in the browser you created them in.
              </p>
            </details>
            <details>
              <summary>Is Nadobot the official Nado app?</summary>
              <p>
                No. Nadobot is an independent tool. The official Nado app is{' '}
                <a href="https://app.nado.xyz" target="_blank" rel="noreferrer">
                  app.nado.xyz
                </a>
                .
              </p>
            </details>
          </section>

          <div className="doc-cta glass">
            <div>
              <h3>Ready to try it?</h3>
              <p className="muted">Start on testnet with practice funds, then switch to mainnet when you&apos;re comfortable.</p>
            </div>
            <Link href="/dashboard" className="btn btn-primary">
              Launch App
            </Link>
          </div>
        </article>
      </div>
    </main>
  );
}
