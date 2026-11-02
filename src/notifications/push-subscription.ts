export const NotificationErrorCode = {
  InvalidSubscription: "INVALID_SUBSCRIPTION",
  PushDisabled: "PUSH_DISABLED",
} as const;

export type NotificationErrorCode = (typeof NotificationErrorCode)[keyof typeof NotificationErrorCode];

export class NotificationError extends Error {
  constructor(
    readonly code: NotificationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "NotificationError";
  }
}

export interface PushSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface StoredPushSubscription extends PushSubscription {
  memberId: string;
}

// The server only ever sends to the browsers' own push services, never to an address someone
// made up, so a subscription can't be used to make the server call into other systems.
const PUSH_SERVICE_HOSTS = [
  "fcm.googleapis.com",
  "updates.push.services.mozilla.com",
  "push.apple.com",
  "notify.windows.com",
];

function isPushServiceHost(host: string) {
  return PUSH_SERVICE_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

export function validatePushSubscription(subscription: PushSubscription) {
  let url: URL | undefined;
  try {
    url = new URL(subscription.endpoint);
  } catch {
    url = undefined;
  }
  if (!url || url.protocol !== "https:" || url.port !== "" || !isPushServiceHost(url.hostname)) {
    throw new NotificationError(
      NotificationErrorCode.InvalidSubscription,
      "This browser's notification address isn't one Collabitat can send to.",
    );
  }
  return subscription;
}
