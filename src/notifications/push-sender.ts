import webpush, { WebPushError } from "web-push";
import type { PushSubscription } from "./push-subscription.js";

export interface PushMessage {
  title: string;
  body: string;
  // Notifications with the same tag replace each other on the device instead of piling up.
  tag: string;
}

export type PushResult = "sent" | "gone" | "failed";

export interface PushSender {
  readonly publicKey: string;
  send(subscription: PushSubscription, message: PushMessage): Promise<PushResult>;
}

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
  subject: string;
}

const GONE_STATUSES = new Set([404, 410]);
// A reminder that arrives a day late is noise, so the push service may drop it after that.
const TIME_TO_LIVE_SECONDS = 12 * 60 * 60;

export class WebPushSender implements PushSender {
  readonly publicKey: string;

  constructor(private readonly keys: VapidKeys) {
    this.publicKey = keys.publicKey;
  }

  async send(subscription: PushSubscription, message: PushMessage): Promise<PushResult> {
    try {
      await webpush.sendNotification(subscription, JSON.stringify(message), {
        vapidDetails: this.keys,
        TTL: TIME_TO_LIVE_SECONDS,
      });
      return "sent";
    } catch (error) {
      return error instanceof WebPushError && GONE_STATUSES.has(error.statusCode) ? "gone" : "failed";
    }
  }
}
