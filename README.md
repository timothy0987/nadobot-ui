# Nadobot

> **Independent, unofficial tool.** Nadobot is built on Nado's public API and is not affiliated with, endorsed by, or operated by Nado. The official Nado app is [app.nado.xyz](https://app.nado.xyz). Nadobot never asks for token approvals, transfers or on-chain transactions; the only wallet requests are signed Nado messages (`Order`, `Cancellation`, `ListTriggerOrders`).

Trading automation for [Nado](https://www.nado.xyz), the unified spot/perps orderbook DEX on Ink L2. Two parts in this repo:

- **Dashboard** (repo root, Next.js, deployed on Vercel) - any trader connects their wallet and creates **trade plans** that keep running while they are offline.
- **`bot/`** (Node/TypeScript, deployed on Railway) - an always-on bot for the operator's own account: dip-buy entries plus automatic stop-loss/take-profit.

## Trade plans: trading while offline, with no custody

A trade plan is three orders the trader signs with their **own wallet**:

1. a limit **entry** resting on Nado's orderbook, and
2. a **stop-loss** and 3. **take-profit** on Nado's [trigger service](https://docs.nado.xyz/developer-resources/api/trigger), which stay dormant until the entry fills.

All three live on Nado's servers, so the plan runs whether or not the dashboard is open. Cancelling the entry automatically cancels its exits.

**Why not a shared bot key?** Nado's [linked signers](https://docs.nado.xyz/developer-resources/get-started/linked-signers) have full permissions, including withdrawals. A single bot key linked to many traders' accounts would let one server compromise drain every account. Trade plans avoid that entirely: nobody but the trader ever holds a key that controls their funds.

## Getting started checklist

A connected wallet that hasn't traded yet sees a short checklist at the top of the dashboard. Each step uses data the dashboard already loads:

1. **Use a Nado network:** the wallet is on Ink Sepolia or Ink mainnet.
2. **Fund your Nado account:** the account exists with at least $5 of value. Links to depositing on app.nado.xyz, or to the testnet faucet.
3. **Turn on notifications:** optional, and skipped where the browser can't show push.
4. **Place your first trade:** the wallet has any fill. Scrolls to *Trade now*.

It hides itself once every required step is done, or when dismissed (remembered per network and wallet in the browser). The logic is in `src/lib/onboarding.ts`, tested in `tests/onboarding.test.ts`.

## Price chart

The dashboard opens on a candlestick chart of the selected market, before any wallet is connected, so traders can read the market and act without leaving Nadobot.

- **Timeframes:** 15m, 1H, 4H and 1D candles from Nado's archive `candlesticks` query, refreshed every 30 seconds.
- **Quiet periods:** Nado only records a candle when something trades, so gaps are filled with flat candles at the previous close to keep time even.
- **Header:** last price, 24h change, high, low and traded value (from hourly candles), and Nado's funding rate, the 24-hour rate from the archive `funding_rate` query, with whether longs or shorts are paying.
- **Your position:** when you hold one, its entry and estimated liquidation price are drawn as lines. A liquidation price outside the visible range is marked at the edge rather than squashing the chart.
- **Hover:** shows a candle's time and open, high, low and close.

The chart is SVG sized to its container, with a round-number price axis. Data helpers are in `src/lib/chart.ts`, tested in `tests/chart.test.ts`.

## Trade now (market and limit orders)

The *Trade now* ticket buys or sells at the market. It sends an IOC order at the touch with a 1% slippage cap (a buy lifts the ask, a sell hits the bid), sized in USD, in the coin, or by risk. It has an optional stop-loss and take-profit and the same risk preview as the other tools. After signing, the dashboard reads the position back to find how much actually filled. It then places reduce-only exits sized to exactly that fill, so a partial fill gets exits for what was traded. If the IOC finds no liquidity, the trader is told nothing was traded. When the account already holds the opposite side, exits are switched off, since the order first reduces that position. Counted as the anonymous `market_order` event.

Under the size fields, the ticket shows the largest order the account's margin allows on the chosen side at the fill price, with 25%, 50%, 75% and Max buttons that fill in the size. `maxTradeSize` binary-searches lots against the same health projection as the risk preview (so an opposite position being reduced first frees margin), and leaves 5% of available margin unused as a cushion for fees and price movement. With a stop-loss set, it also keeps the estimated liquidation price at least 1% of the price beyond the stop, leaving room for the exit's slippage, so a Max order passes the risk checks.

The ticket's *Limit* tab rests an order at the trader's price, defaulting to their own side of the book (best bid for a buy, best ask for a sell). A buy price rounds down and a sell rounds up to the tick. Post-only is on by default (order type bit `POST_ONLY`), and a post-only price at or through the other side is refused before signing; with post-only off, a crossing price shows a warning that it will fill straight away. Expiry defaults to 7 days. Stop-loss and take-profit are priced from the limit price and placed straight after as reduce-only price triggers that depend on the entry digest (`on_partial_fill: true`), so they activate only when it fills. The $100 minimum is checked at the limit price. Counted as the anonymous `limit_order` event. Logic in `planLimitOrder` and `placeLimitOrder`, tested in `tests/limit-order.test.ts`.

## Quick strategies

One-tap presets at the top of the dashboard fill in the matching form for the selected market. Nothing is placed until the trader reviews the preview and risk checks and signs.

- **Buy the dip**: a weighted long ladder 1–6% below the price, 5% stop, targets at 4/8/12%.
- **Risk $25, aim for 2×**: a trade plan 1% below the price, sized by risk, 3% stop, 6% target.
- **Sell the rally**: a short ladder 1–5% above the price, 5% stop, targets at 4/8%.
- **Daily DCA**: $1,000 over 24 hours every 4 hours, with the renewal reminder on.
- **Enter quietly over an hour**: a $2,000 TWAP in 10 slices over 60 minutes.

Presets are defined in `src/lib/presets.ts` as offsets from the market, so they work on any market. `tests/presets.test.ts` runs every preset through the real planners on BTC, ETH and TON parameters recorded from Nado, so a preset can never fill in something the dashboard or Nado would reject.

## Markets, risk checks and sizing by risk

- **Every live Nado perp market**, from a searchable picker that remembers your choice (BTC, ETH and SOL first). Prices display and round at each market's own tick, down to $0.000001.
- **Risk preview on every order** (trade plans, ladders, TWAP/DCA), assuming it fully fills: estimated liquidation price, account leverage before and after, and margin used and left. It uses Nado's health model: a perp contributes `amount × price × weight + v_quote`, with initial weights for margin and maintenance weights for liquidation. The projection matches Nado's own `subaccount_info` `apply_delta` simulation exactly. Margin is judged at the order's fill price, since a limit entry only fills once the market reaches it; the liquidation price doesn't depend on that choice.
- **Blocked before signing**: orders that would take initial health below zero (Nado would reject them), and stop-losses beyond the estimated liquidation price. Warnings appear when liquidation would be within 10% of the price, or leverage would reach 10x.
- **Size by risk** in trade plans and ladders: enter the most you're willing to lose, and the size is `risk ÷ distance to the stop`, rounded down to the lot size.

## Portfolio: positions, PnL and volume

The connected wallet's trading on Nado, across every market and every app it trades from. It's all public gateway and indexer data, so it needs no signature.

- **Open positions** at Nado's oracle (mark) price: entry, value, unrealized PnL and funding. Sizes come from the gateway, so a fresh fill shows up before the indexer catches up.
- **Close or trim in one click**: 25%, 50% or all of a position, as an IOC reduce-only order capped 1% past the touch, after a confirmation showing the exact size, value and worst fill price. Partial closes round down to whole lots and are refused below the market minimum order.
- **History** of closed positions: entry → exit, time held, fees plus funding, and net PnL. Older pages load on demand.
- **Shareable PnL cards**: *Share* on a closed position draws a 1200×630 image in the browser (canvas, no server). It shows the net return after fees and funding, as a share of the largest position's entry value, plus entry, exit, time held and date, with the site address. Dollar amounts are off by default. The trader can download it, copy it, use the device share sheet where supported, or open a prefilled post on X.
- **24h / 7d / 30d**: realized PnL after fees, volume, fill count and maker share, plus lifetime volume. A chart shows volume per hour (24h) or per day, with cumulative realized PnL over it.
- With `NEXT_PUBLIC_BUILDER_ID` set, **Via Nadobot** shows how much of the wallet's volume carried the builder code, read from each filled order's appendix.

## Ladders and scaled take-profits

Instead of one entry price, spread the entry across **up to 10 limit orders** between a first and last price, then close the position in **up to 4 take-profit steps**, with one stop-loss covering the whole ladder.

- **Even** puts the same size on every entry; **Weighted** puts more size on better prices (1x on the first entry up to Nx on the last).
- Stop-loss and targets are set as a distance from the average entry. The preview shows every order, the average entry, the loss at the stop and the profit if every target hits.
- Order of placement: the first entry, then the stop-loss and take-profits (dormant until that entry fills; price always reaches it before deeper entries), then the other entries. Exits are reduce-only and sized for the full ladder, so they never close more than has filled.
- Before signing, the dashboard checks that entries rest on the book instead of filling instantly, the stop sits beyond the last entry, every target sits beyond the first entry, and every entry and target is worth at least the market minimum ($100 on BTC-PERP). Nado's trigger service only checks that minimum when an exit fires, so an undersized target would otherwise fail silently.
- One wallet signature per order (entries + 1 + targets). If a signature is rejected partway, the dashboard offers to roll back what was placed.
- **Your ladders** shows how many entries are still resting, with *Cancel unfilled entries* (keeps the exits on what filled) and *Cancel entries and exits*. Only orders that are still open are sent, because Nado rejects a whole cancel batch if any order in it is already gone.

## Moving a stop-loss or take-profit

*My orders* can re-place an exit at a new level: the replacement goes in first, then the old one is cancelled (two signatures). In that order a rejected second signature leaves the position over-protected rather than unprotected, and both orders are reduce-only, so whichever fires first closes the position and the other can only be a no-op. The dependency on an unfilled entry is carried over, the limit keeps the 0.5% exit slippage, and a level the last price has already passed is refused before signing. If the cancel fails, the dashboard says so and points at the old order.

## TWAP and DCA

Split a large order into slices that Nado executes over time, from **one signature** (a [TWAP order](https://docs.nado.xyz/developer-resources/api/trigger) on the trigger service, so it also runs while the dashboard is closed):

- **TWAP** - N executions spread over a number of minutes, to reduce price impact.
- **DCA** - a fixed amount every 15 min to 4 h, for up to 24 hours per schedule.

Every slice is an IOC order bounded by a max slippage and a hard limit price ("never buy above / never sell below"), and carries the builder code. Progress, the next execution and failed slices show under the form, and a schedule can be cancelled at any time.

Nado's limits, checked before you sign: 1-500 executions, the whole schedule must finish within **25 hours**, and each slice must be worth at least the market's minimum order (**$100** on BTC-PERP).

**Renewal reminders.** Because of the 25-hour cap, a daily DCA would stop silently. With *Remind me when it ends* ticked (and push on), the dashboard registers the schedule with the bot (`POST /push/reminders`, keyed by the device's push endpoint). A minute after the last execution is due, the bot asks Nado's `list_twap_executions` how it ended. A cancelled schedule is dropped silently, one still executing is checked again, and a finished one gets a push that opens `/dashboard?market=SYMBOL&renew=DIGEST`. The dashboard then fills in the same side, size, frequency and length from the schedule this browser saved, for the trader to review and sign. Cancelling a schedule in the dashboard also removes its reminder.

## Networks

The dashboard switches between **Ink Sepolia (testnet)** and **Ink mainnet** from the header; the wallet is asked to change chains and the choice is remembered. Before the first mainnet order, traders must acknowledge that orders use real funds. Fill notifications follow the network the trader subscribed from.

## The bot

- **Entry:** buys `TRADE_AMOUNT` when price drops `TRADE_DROP_PERCENTAGE` below its session high, never past `MAX_POSITION_SIZE`.
- **Protection:** keeps exactly one stop-loss and one take-profit on any open position, bot-opened or manual. They are resized whenever the position grows or its average entry moves, and cleaned up once it closes. Only reduce-only orders are touched, so a trader's own orders are left alone.
- **Kill switch:** set `TRADING_PAUSED=true` in Railway to stop all new buys at once. Open positions stay protected.
- **Daily loss limit:** once today's realized PnL minus fees reaches -`DAILY_LOSS_LIMIT_USD` (default $25), new buys pause until 00:00 UTC. It is computed from Nado's own trade history, so a restart can't reset it, and buys pause if that history can't be read. It counts realized losses; an open position's unrealized loss is capped by its stop-loss instead.
- **Status:** `GET /status` serves read-only JSON (strategy, position, protection, last error) that the dashboard displays.
- **Alerts in the dApp:** the bot keeps an activity log (started, bought, protection placed/resized, position closed, loss limit hit, errors) that the dashboard shows as a feed and pops up as notifications.

Every price and size is rounded to the market's tick and lot size; Nado rejects anything off-grid.

### Local development

```bash
cd bot
npm install
cp .env.example .env   # set PRIVATE_KEY; defaults to Nado testnet (Ink Sepolia)
npm run dev
npm test
```

See [`bot/.env.example`](bot/.env.example) for every option.

## Dashboard local development

```bash
npm install
npm run dev
```

Optional environment variables:

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_BOT_STATUS_URL` | Bot status endpoint. Defaults to the production bot on Railway. |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | Reown (WalletConnect) project ID. Defaults to Nadobot's; add your site's domain to its allowlist on cloud.reown.com. |
| `NEXT_PUBLIC_BUILDER_ID` | Your Nado builder ID (see below). |
| `NEXT_PUBLIC_BUILDER_FEE_RATE_TENTH_BPS` | Builder fee in 0.1bps units (10 = 1bps = 0.01%). Ignored unless a builder ID is set. |

## Usage stats

To show which tools traders use and how much order value flows through Nadobot (e.g. for the builder program), the dashboard sends anonymous events to the bot: `POST /events` with `{ name, chainId, valueUsd }` only. The events are `wallet_connected` (once per browser session), `plan_created`, `ladder_placed`, `twap_started`, `dca_started`, `position_protected`, `position_closed`, `exit_moved`, `alert_set`, `dca_reminder_set` and `card_shared`.

- The bot keeps daily totals per network and event in `DATA_DIR/usage.json` for 180 days, and saves them on shutdown.
- No wallet address, account, market, IP, cookie or identifier is sent or stored. Unknown event names and extra fields are rejected.
- Browsers sending Do Not Track or Global Privacy Control send nothing.
- `GET /stats?days=30` returns the totals, and the public **/stats** page shows order value placed, orders and schedules, wallet sessions, shares, a daily chart and a per-tool table.
- Value is order size at placement, not what filled.

## Tests

```bash
npm test          # dashboard: order encoding, planners, risk, portfolio, placement (Vitest)
cd bot && npm test  # bot (Jest)
```

The dashboard suite in `tests/` covers the code where a silent mistake would cost traders money:

- **Encoding**: order appendix bits (checked against an appendix Nado recorded for a real order), TWAP value field, nonces, x18 conversion, and rounding to ticks and lots.
- **Planners**: trade plan, ladder and TWAP sizes and prices, and every validation error. Ladders always add up exactly: entries, stop and targets each equal the full size.
- **Risk**: `tests/fixtures/nado-testnet.json` holds a real testnet account's health plus Nado's own `apply_delta` simulation of four trades. The projection must match Nado to 6 decimals, and liquidation prices must bring maintenance health to zero.
- **Placement**: against a fake Nado, the ladder must place the first entry, then its exits (dependent on that entry, reduce-only), then the other entries. A rejected signature must report what is already live, and cancels must skip orders that are already gone.

To refresh the fixture, run a script that re-queries `subaccount_info` for a testnet account with no positions outside the recorded products, and review the diff.

## Builder code revenue

Orders placed by the dashboard and the bot carry a builder ID and fee rate, so the builder earns a share of every trade.

1. Contact the Nado team to register as a builder. They assign your builder ID and allowed fee range (see [Builder Integration](https://docs.nado.xyz/developer-resources/api/builder-integration)).
2. Set `NEXT_PUBLIC_BUILDER_ID` / `NEXT_PUBLIC_BUILDER_FEE_RATE_TENTH_BPS` on Vercel, and `BUILDER_ID` / `BUILDER_FEE_RATE_TENTH_BPS` on Railway.
3. Fees accrue on-chain. Claim them with a `ClaimBuilderFee` slow-mode transaction to a funded Nado subaccount, then withdraw normally.

Leave both at `0` until registered: Nado rejects a fee rate without a valid builder ID.

## Alerts

Alerts live inside the dApp. No Telegram or other third-party bot is involved.

- **Bot activity:** the dashboard shows the bot's activity feed and pops a notification for each new event.
- **Your orders:** when a connected wallet's order fills (a plan entry, stop-loss or take-profit), the dashboard shows it with size, price and any realized PnL.
- **Push notifications:** turn them on in the dashboard's *Push notifications* panel to be notified on that device even with the dashboard closed: when your orders fill, and/or about Nadobot activity. The Railway bot stores the subscription, watches Nado for the wallet's fills every 30 seconds, and sends the push. On iPhone/iPad, add the dashboard to the Home Screen first.

- **Price alerts:** a trader asks to be told when a market reaches a price. The bot polls each network's oracle prices every 30 seconds (one `all_products` query per network that has alerts) and pushes when the level is *crossed*, comparing with the previous poll so a price hovering at the level can't notify repeatedly. Alerts fire once and are removed. The notification opens `/dashboard?market=SYMBOL`, so the trader lands on that market ready to trade. Alerts belong to a device (its push subscription), not a wallet, and are stored with it: `POST /push/alerts`, `/push/alerts/list`, `/push/alerts/delete`, max 20 per device. A level already met is refused, since it would fire at once.

Push needs no secrets from you: the bot generates its VAPID key pair on first start and keeps it, with the subscriptions, in `DATA_DIR`. Put that on a persistent Railway volume, or every redeploy resets subscriptions (the dashboard resubscribes on the next visit). The bot only sends to real browser push services (Google, Mozilla, Apple, Microsoft). The bot's activity log lives in memory, so a restart starts it fresh; its trade history always comes from Nado.

## Deployment

- **Dashboard:** Vercel, root directory = repo root.
- **Bot:** Railway service created from this GitHub repo with Root Directory `/bot`, the variables from `bot/.env.example`, and a generated public domain for the status endpoint. It auto-deploys on pushes to `main`; set Settings → Build → Watch Paths to `/bot/**` so dashboard-only changes don't restart the bot (a restart resets its dip-buy session high).

Start on testnet (`NADO_ENV=testnet`, the default) before pointing anything at mainnet funds.
