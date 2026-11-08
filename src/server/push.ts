import { z } from 'zod';
import type { PushSubscribeRequest } from '../shared/api.js';
import { JsonFile } from './fsutil.js';
import type { Logger } from './logger.js';

const SubSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string(), auth: z.string() }),
  deviceId: z.string(),
  createdAt: z.string(),
});
const SubsSchema = z.object({ subscriptions: z.array(SubSchema) });
export type StoredSubscription = z.infer<typeof SubSchema>;

export interface PushPayload {
  title: string;
  body: string;
  /** In-app path to open, such as `/#/s/<id>`. */
  url: string;
  tag: string;
}

export interface VapidKeys {
  subject: string;
  publicKey: string;
  privateKey: string;
}

/** Sends one push message. Returns the push service's HTTP status code. */
export type PushSender = (sub: StoredSubscription, payload: string, vapid: VapidKeys) => Promise<number>;

export function webPushSender(): PushSender {
  return async (sub, payload, vapid) => {
    const webpush = await import('web-push');
    try {
      const res = await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, payload, {
        vapidDetails: vapid,
        TTL: 6 * 3600,
        urgency: 'high',
        timeout: 15_000,
      });
      return res.statusCode;
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (typeof status === 'number') return status;
      throw err;
    }
  };
}

export async function generateVapidKeys(): Promise<{ publicKey: string; privateKey: string }> {
  const webpush = await import('web-push');
  return webpush.generateVAPIDKeys();
}

const PUSH_HOST = /^https:\/\/([a-z0-9-]+\.)+[a-z]{2,}(:\d+)?\//i;

/** Web Push subscriptions per device, with pruning of expired endpoints. */
export class PushService {
  private file: JsonFile<z.infer<typeof SubsSchema>>;

  constructor(
    path: string,
    private readonly vapid: () => VapidKeys | null,
    private readonly sender: PushSender,
    private readonly log: Logger,
  ) {
    this.file = new JsonFile(path, SubsSchema, () => ({ subscriptions: [] }), 0o600);
  }

  publicKey(): string | null {
    return this.vapid()?.publicKey ?? null;
  }

  subscribe(deviceId: string, sub: PushSubscribeRequest): void {
    if (!PUSH_HOST.test(sub.endpoint)) throw new Error('Push endpoint must be an https URL');
    this.file.update((d) => {
      d.subscriptions = d.subscriptions.filter((s) => s.endpoint !== sub.endpoint);
      d.subscriptions.push({ endpoint: sub.endpoint, keys: sub.keys, deviceId, createdAt: new Date().toISOString() });
    });
  }

  unsubscribe(endpoint: string): void {
    this.file.update((d) => {
      d.subscriptions = d.subscriptions.filter((s) => s.endpoint !== endpoint);
    });
  }

  removeDevice(deviceId: string): void {
    this.file.update((d) => {
      d.subscriptions = d.subscriptions.filter((s) => s.deviceId !== deviceId);
    });
  }

  count(deviceId?: string): number {
    return this.file.get().subscriptions.filter((s) => !deviceId || s.deviceId === deviceId).length;
  }

  /** Send to every subscription (or one device). Expired subscriptions are removed. */
  async notify(payload: PushPayload, deviceId?: string): Promise<{ sent: number; pruned: number; failed: number }> {
    const vapid = this.vapid();
    const subs = this.file.get().subscriptions.filter((s) => !deviceId || s.deviceId === deviceId);
    const result = { sent: 0, pruned: 0, failed: 0 };
    if (!vapid || subs.length === 0) return result;
    const body = JSON.stringify(payload);
    const dead: string[] = [];
    await Promise.all(
      subs.map(async (s) => {
        try {
          const status = await this.sender(s, body, vapid);
          if (status === 404 || status === 410) {
            dead.push(s.endpoint);
            result.pruned++;
          } else if (status >= 200 && status < 300) result.sent++;
          else {
            result.failed++;
            this.log.warn('push rejected', { status });
          }
        } catch (err) {
          result.failed++;
          this.log.warn('push failed', { err });
        }
      }),
    );
    if (dead.length) {
      this.file.update((d) => {
        d.subscriptions = d.subscriptions.filter((s) => !dead.includes(s.endpoint));
      });
    }
    return result;
  }
}
