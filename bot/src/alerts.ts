import axios from 'axios';
import { ENV } from './config/env';

/** Fire-and-forget alert to Telegram and/or Discord. Never throws: a failed alert must not stop trading. */
export async function notify(message: string) {
  const text = `[nadobot ${ENV.NADO_ENV}] ${message}`;
  console.log(`ALERT: ${message}`);

  const sends: Promise<unknown>[] = [];
  if (ENV.TELEGRAM_BOT_TOKEN && ENV.TELEGRAM_CHAT_ID) {
    sends.push(
      axios.post(`https://api.telegram.org/bot${ENV.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        chat_id: ENV.TELEGRAM_CHAT_ID,
        text,
      })
    );
  }
  if (ENV.DISCORD_WEBHOOK_URL) {
    sends.push(axios.post(ENV.DISCORD_WEBHOOK_URL, { content: text }));
  }

  const results = await Promise.allSettled(sends);
  for (const r of results) {
    if (r.status === 'rejected') console.error('Alert delivery failed:', r.reason?.message ?? r.reason);
  }
}
