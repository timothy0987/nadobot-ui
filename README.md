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
- **Status:** `GET /status` serves read-only JSON (strategy, position, protection, last error) that the dashboard displays.
- **Alerts:** optional Telegram and/or Discord messages on buys, protection changes, closed positions and errors.

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

## Alerts setup

- **Telegram:** create a bot with [@BotFather](https://t.me/BotFather), send it a message, then read your chat id from `https://api.telegram.org/bot<token>/getUpdates`. Set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` on Railway.
- **Discord:** Server Settings → Integrations → Webhooks → New Webhook → Copy URL. Set `DISCORD_WEBHOOK_URL` on Railway.

## Deployment

- **Dashboard:** Vercel, root directory = repo root.
- **Bot:** Railway service created from this GitHub repo with Root Directory `/bot`, the variables from `bot/.env.example`, and a generated public domain for the status endpoint. It auto-deploys on every push to `main`.

Start on testnet (`NADO_ENV=testnet`, the default) before pointing anything at mainnet funds.
