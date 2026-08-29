# Nadobot

An automated trading companion for [Nado](https://www.nado.xyz), the unified spot/perps orderbook DEX on Ink L2. Two parts in this repo:

- **Dashboard** (repo root) - a Next.js app: connect your wallet, view live balances/positions/orders, and set stop-loss/take-profit protection on an open position. Deployed on Vercel.
- **`bot/`** - a Node/TypeScript always-on bot: watches the market, opens positions on a configurable dip-buy strategy, and keeps every open position protected with server-side stop-loss/take-profit trigger orders so a trade stays managed even if the bot's host goes offline. Meant to run continuously (e.g. on Railway), not on Vercel's serverless runtime.

## How "trade while offline" works

Both the dashboard and the bot use [Nado's trigger service](https://docs.nado.xyz/developer-resources/api/trigger) to attach stop-loss / take-profit as conditional orders that live on Nado's own infrastructure. Once placed, they fire on Nado's servers when the price condition is met - independent of whether the bot process or your browser is still running.

## Dashboard - local development

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Bot - local development

```bash
cd bot
npm install
cp .env.example .env   # fill in PRIVATE_KEY; defaults to Nado testnet (Ink Sepolia)
npm run dev
```

See [`bot/.env.example`](bot/.env.example) for every config option (strategy, stop-loss/take-profit %, testnet vs mainnet).

## Deployment

- **Dashboard**: Vercel, root directory = repo root.
- **Bot**: Railway (`bot/Dockerfile` + `bot/railway.json` already set up) - set the same env vars as `bot/.env.example` in the Railway project, with a real `PRIVATE_KEY` for the bot's trading wallet.

Start on testnet (`NADO_ENV=testnet`, the default) before ever pointing the bot at a mainnet wallet.
