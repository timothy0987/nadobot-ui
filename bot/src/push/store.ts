import fs from 'fs';
import path from 'path';
import webpush from 'web-push';
import type { PriceAlert } from './alerts';

export type PushTopic = 'bot' | 'fills';

export interface PushRecord {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  subaccount: string | null; // wallet subaccount whose fills to announce
  chainId: number; // network of that wallet
  topics: PushTopic[];
  createdAt: string;
  lastSeenSubmissionIdx: string | null;
  /** Price alerts this device asked for. */
  alerts?: PriceAlert[];
}

interface StoreData {
  vapid: { publicKey: string; privateKey: string };
  subscriptions: PushRecord[];
}

/**
 * Push subscriptions plus the VAPID key pair, persisted as one JSON file. The key pair is generated here on first
 * run, so the private key never has to be handled by a person. Keep DATA_DIR on a persistent volume: losing it
 * invalidates every subscription.
 */
export class PushStore {
  private data: StoreData;
  private readonly file: string;

  /** @param defaultChainId network assumed for records saved before subscriptions carried one */
  constructor(dir: string, defaultChainId: number) {
    this.file = path.join(dir, 'push.json');
    fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(this.file)) {
      this.data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      const legacy = this.data.subscriptions.filter((s) => s.chainId == null);
      for (const s of legacy) s.chainId = defaultChainId;
      if (legacy.length) this.save();
    } else {
      this.data = { vapid: webpush.generateVAPIDKeys(), subscriptions: [] };
      this.save();
    }
  }

  get vapid() {
    return this.data.vapid;
  }

  get subscriptions(): readonly PushRecord[] {
    return this.data.subscriptions;
  }

  upsert(record: PushRecord) {
    // Stored as a copy: the caller keeping a reference must not be able to change saved data by accident.
    const stored = { ...record, alerts: record.alerts ? [...record.alerts] : undefined };
    const i = this.data.subscriptions.findIndex((s) => s.endpoint === record.endpoint);
    if (i >= 0) this.data.subscriptions[i] = stored;
    else this.data.subscriptions.push(stored);
    this.save();
  }

  remove(endpoint: string) {
    const before = this.data.subscriptions.length;
    this.data.subscriptions = this.data.subscriptions.filter((s) => s.endpoint !== endpoint);
    if (this.data.subscriptions.length !== before) this.save();
  }

  /** Replaces one subscription's alerts. Returns false when the subscription is gone (e.g. notifications were turned off). */
  setAlerts(endpoint: string, alerts: PriceAlert[]) {
    const record = this.data.subscriptions.find((s) => s.endpoint === endpoint);
    if (!record) return false;
    record.alerts = alerts;
    this.save();
    return true;
  }

  setLastSeen(chainId: number, subaccount: string, submissionIdx: string) {
    for (const s of this.data.subscriptions) {
      if (s.subaccount === subaccount && s.chainId === chainId) s.lastSeenSubmissionIdx = submissionIdx;
    }
    this.save();
  }

  private save() {
    // Write-then-rename so a crash mid-write can't leave a truncated file behind.
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }
}
