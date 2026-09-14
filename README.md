# Nadobot

Trading automation for [Nado](https://www.nado.xyz), the unified spot/perps orderbook DEX on Ink L2. Two parts in this repo:

- **Dashboard** (repo root, Next.js, deployed on Vercel) - any trader connects their wallet and creates **trade plans** that keep running while they are offline.
- **`bot/`** (Node/TypeScript, deployed on Railway) - an always-on bot for the operator's own account: dip-buy entries plus automatic stop-loss/take-profit.

## Trade plans: trading while offline, with no custody

A trade plan is three orders the trader signs with their **own wallet**:

1. a limit **entry** resting on Nado's orderbook, and
2. a **stop-loss** and 3. **take-profit** on Nado's [trigger service](https://docs.nado.xyz/developer-resources/api/trigger), which stay dormant until the entry fills.

All three live on Nado's servers, so the plan runs whether or not the dashboard is open. Cancelling the entry automatically cancels its exits.

**Why not a shared bot key?** Nado's [linked signers](https://docs.nado.xyz/developer-resources/get-started/linked-signers) have full permissions, including withdrawals. A single bot key linked to many traders' accounts would let one server compromise drain every account. Trade plans avoid that entirely: nobody but the trader ever holds a key that controls their funds.

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
| `NEXT_PUBLIC_BUILDER_ID` | Your Nado builder ID (see below). |
| `NEXT_PUBLIC_BUILDER_FEE_RATE_TENTH_BPS` | Builder fee in 0.1bps units (10 = 1bps = 0.01%). Ignored unless a builder ID is set. |

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

Push needs no secrets from you: the bot generates its VAPID key pair on first start and keeps it, with the subscriptions, in `DATA_DIR`. Put that on a persistent Railway volume, or every redeploy resets subscriptions (the dashboard resubscribes on the next visit). The bot only sends to real browser push services (Google, Mozilla, Apple, Microsoft). The bot's activity log lives in memory, so a restart starts it fresh; its trade history always comes from Nado.

## Deployment

- **Dashboard:** Vercel, root directory = repo root.
- **Bot:** Railway service created from this GitHub repo with Root Directory `/bot`, the variables from `bot/.env.example`, and a generated public domain for the status endpoint. It auto-deploys on pushes to `main`; set Settings → Build → Watch Paths to `/bot/**` so dashboard-only changes don't restart the bot (a restart resets its dip-buy session high).

Start on testnet (`NADO_ENV=testnet`, the default) before pointing anything at mainnet funds.
