import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Terms of use · Nadobot',
  description: 'The terms for using Nadobot, an independent trading interface built on Nado.',
};

const UPDATED = '15 September 2026';

export default function Terms() {
  return (
    <main className="container doc-page">
      <header className="doc-hero">
        <span className="pill">Legal</span>
        <h1>Terms of use</h1>
        <p className="muted">Last updated {UPDATED}</p>
      </header>

      <article className="doc legal">
        <section>
          <h2>1. About these terms</h2>
          <p>
            These terms apply to your use of Nadobot, including this website, the dashboard and the notification service
            (&ldquo;Nadobot&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;). By using Nadobot you agree to them. If you don&apos;t agree,
            don&apos;t use Nadobot.
          </p>
        </section>

        <section>
          <h2>2. What Nadobot is, and isn&apos;t</h2>
          <p>
            Nadobot is independent software that helps you create and follow orders on Nado, an exchange on the Ink network. Nadobot is an
            interface only:
          </p>
          <ul>
            <li>
              It never holds, controls or has access to your funds or private keys. Your account, balances and positions are on Nado.
            </li>
            <li>It is not an exchange, broker, custodian, investment adviser or fiduciary, and it doesn&apos;t execute trades itself.</li>
            <li>
              Orders you sign are sent to Nado and executed by Nado under Nado&apos;s own rules and terms, which also apply to your Nado
              account.
            </li>
            <li>Nothing on Nadobot is financial, investment, legal or tax advice.</li>
          </ul>
        </section>

        <section>
          <h2>3. Your eligibility and responsibilities</h2>
          <ul>
            <li>You must be of legal age to enter a binding agreement where you live.</li>
            <li>
              You may only use Nadobot where doing so, and trading on Nado, is lawful for you. If Nado isn&apos;t available to you, you may
              not use Nadobot to access it. You must not be subject to sanctions or use Nadobot on behalf of anyone who is.
            </li>
            <li>
              You are responsible for your wallet and its security, for reading every signature request before approving it, and for
              any taxes on your trading.
            </li>
          </ul>
        </section>

        <section>
          <h2>4. Orders, signatures and estimates</h2>
          <ul>
            <li>
              Every order you sign is your own instruction to Nado. Signed orders can&apos;t be reversed; you can only cancel what hasn&apos;t
              filled yet.
            </li>
            <li>
              Previews such as liquidation prices, leverage, margin, sizes by risk, profit and loss, and volume are estimates. They may be
              inaccurate or out of date, and they don&apos;t replace Nado&apos;s own figures.
            </li>
            <li>
              Stop-losses, take-profits, ladders and TWAP or DCA schedules are not guaranteed to fill, or to fill at a particular price.
              Outages or delays at Nado, the Ink network, your wallet, your browser or Nadobot may prevent orders from being placed,
              executed or cancelled.
            </li>
          </ul>
        </section>

        <section>
          <h2>5. Fees</h2>
          <p>
            Nado charges its own trading fees. Nadobot may add a builder fee on filled orders placed through it, collected by Nado as part
            of the trade. Any Nadobot fee is shown in <Link href="/how-it-works#fees">How it works</Link> and is included in the orders you
            sign. We may change the fee for future orders; orders you have already signed keep the fee they were signed with.
          </p>
        </section>

        <section>
          <h2>6. Risks</h2>
          <p>
            Trading perpetual futures with leverage is highly risky. Prices can move quickly, positions can be liquidated, and you can lose
            all of the funds in your Nado account. Blockchain networks, exchanges and wallets can fail, be attacked or change without
            notice. Testnet is for practice only; mainnet uses real funds. Only trade what you can afford to lose.
          </p>
        </section>

        <section>
          <h2>7. Acceptable use</h2>
          <p>You agree not to:</p>
          <ul>
            <li>use Nadobot for anything unlawful, including market manipulation or fraud;</li>
            <li>attack, overload, probe or disrupt Nadobot, Nado or the networks they rely on;</li>
            <li>use Nadobot to get around restrictions that Nado or the law places on you;</li>
            <li>misrepresent Nadobot as operated or endorsed by anyone else, or copy it to mislead others.</li>
          </ul>
        </section>

        <section>
          <h2>8. Third-party services</h2>
          <p>
            Nadobot relies on services we don&apos;t control, including Nado, the Ink network, wallet apps, WalletConnect, browser push
            services and our hosting providers. Their terms and privacy policies apply to your use of them, and we aren&apos;t responsible
            for their availability or actions.
          </p>
        </section>

        <section>
          <h2>9. No warranty</h2>
          <p>
            Nadobot is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;, without warranties of any kind, express or implied,
            including that it will be accurate, uninterrupted, secure or error-free.
          </p>
        </section>

        <section>
          <h2>10. Limitation of liability</h2>
          <p>
            To the fullest extent permitted by law, we are not liable for any loss or damage arising from your use of, or inability to use,
            Nadobot. This includes trading losses, liquidations, missed or partial fills, lost profits, errors in estimates, and losses
            caused by third-party services. Some jurisdictions don&apos;t allow certain limitations, so parts of this section may not apply
            to you.
          </p>
        </section>

        <section>
          <h2>11. Changes and ending use</h2>
          <p>
            We may change, suspend or stop Nadobot, or update these terms, at any time. The date above shows the latest version, and
            continuing to use Nadobot after an update means you accept it. You can stop using Nadobot at any time; orders you already signed
            stay on Nado until they fill, expire or you cancel them.
          </p>
        </section>

        <p className="muted">
          See also our <Link href="/privacy">Privacy notice</Link> and <Link href="/how-it-works">How Nadobot works</Link>.
        </p>
      </article>
    </main>
  );
}
