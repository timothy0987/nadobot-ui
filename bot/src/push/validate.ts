import type { PushTopic } from './store';

// The bot POSTs to whatever endpoint a subscriber sends, so only real browser push services are accepted.
// Without this, anyone could make the bot send requests to arbitrary URLs.
const PUSH_HOSTS = ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'push.services.mozilla.com', 'web.push.apple.com'];
const PUSH_HOST_SUFFIXES = ['.notify.windows.com', '.push.apple.com'];

const BASE64URL = /^[A-Za-z0-9_-]+={0,2}$/;
const SUBACCOUNT = /^0x[0-9a-f]{64}$/;
const TOPICS: PushTopic[] = ['bot', 'fills'];
// Ink mainnet and Ink Sepolia: fill notifications follow the network the trader is on, not the bot's own network.
export const SUPPORTED_CHAIN_IDS = [57073, 763373];

export interface SubscribeInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  subaccount: string | null;
  topics: PushTopic[];
  chainId: number | null;
}

export function isAllowedPushEndpoint(endpoint: unknown): endpoint is string {
  if (typeof endpoint !== 'string' || endpoint.length > 1024) return false;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return false;
  const host = url.hostname.toLowerCase();
  return PUSH_HOSTS.includes(host) || PUSH_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

/** Pure: validates a /push/subscribe body. Returns the clean input, or an error message for the client. */
export function parseSubscribe(body: any): SubscribeInput | { error: string } {
  const sub = body?.subscription;
  if (!isAllowedPushEndpoint(sub?.endpoint)) return { error: 'Unsupported push endpoint' };
  const { p256dh, auth } = sub.keys ?? {};
  if (typeof p256dh !== 'string' || !BASE64URL.test(p256dh) || p256dh.length < 80 || p256dh.length > 100) return { error: 'Invalid p256dh key' };
  if (typeof auth !== 'string' || !BASE64URL.test(auth) || auth.length < 16 || auth.length > 32) return { error: 'Invalid auth key' };

  const topics = Array.isArray(body.topics) ? [...new Set(body.topics)] : [];
  if (topics.length === 0 || !topics.every((t): t is PushTopic => TOPICS.includes(t as PushTopic))) return { error: 'Invalid topics' };

  const subaccount = body.subaccount == null ? null : String(body.subaccount).toLowerCase();
  if (subaccount !== null && !SUBACCOUNT.test(subaccount)) return { error: 'Invalid subaccount' };
  if (topics.includes('fills') && !subaccount) return { error: 'Fill notifications need a connected wallet' };

  const chainId = body.chainId == null ? null : Number(body.chainId);
  if (chainId !== null && !SUPPORTED_CHAIN_IDS.includes(chainId)) return { error: 'Unsupported network' };

  return { endpoint: sub.endpoint, keys: { p256dh, auth }, subaccount, topics: topics as PushTopic[], chainId };
}
