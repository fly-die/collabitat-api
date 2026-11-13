import type { FastifyInstance } from "fastify";
import { HttpStatus } from "../http-status.js";
import type { Authenticate } from "../sessions/authenticate.js";
import {
  NotificationError,
  NotificationErrorCode,
  validatePushSubscription,
  type PushSubscription,
} from "./push-subscription.js";
import {
  NOTIFICATION_TOPICS,
  type NotificationPreferenceRepository,
  type NotificationPreferences,
} from "./notification-preferences.js";
import type { PushSubscriptionRepository } from "./push-subscription-repository.js";

export const PUSH_SUBSCRIPTION_PATH = "/household/push-subscription";
const PREFERENCES_PATH = "/household/notification-preferences";
const MAX_ENDPOINT_LENGTH = 2048;
const MAX_KEY_LENGTH = 256;

const endpointProperty = { type: "string", minLength: 1, maxLength: MAX_ENDPOINT_LENGTH } as const;
const keyProperty = { type: "string", minLength: 1, maxLength: MAX_KEY_LENGTH } as const;

const subscriptionBodySchema = {
  type: "object",
  required: ["endpoint", "keys"],
  properties: {
    endpoint: endpointProperty,
    keys: {
      type: "object",
      required: ["p256dh", "auth"],
      properties: { p256dh: keyProperty, auth: keyProperty },
    },
  },
} as const;

const endpointBodySchema = {
  type: "object",
  required: ["endpoint"],
  properties: { endpoint: endpointProperty },
} as const;

const preferencesBodySchema = {
  type: "object",
  required: [...NOTIFICATION_TOPICS],
  properties: Object.fromEntries(NOTIFICATION_TOPICS.map((topic) => [topic, { type: "boolean" }])),
} as const;

interface NotificationRouteDependencies {
  authenticate: Authenticate;
  subscriptions: PushSubscriptionRepository;
  preferences: NotificationPreferenceRepository;
  // Undefined when the server has no push keys: notifications are then off for everyone.
  publicKey: string | undefined;
}

export function notificationRoutes({ authenticate, subscriptions, preferences, publicKey }: NotificationRouteDependencies) {
  const requirePublicKey = () => {
    if (!publicKey) {
      throw new NotificationError(NotificationErrorCode.PushDisabled, "Notifications aren't set up on this server.");
    }
    return publicKey;
  };

  return async function register(app: FastifyInstance) {
    app.get("/push/public-key", async () => ({ publicKey: requirePublicKey() }));

    app.put<{ Body: PushSubscription }>(
      PUSH_SUBSCRIPTION_PATH,
      { schema: { body: subscriptionBodySchema } },
      async (request, reply) => {
        const { currentMemberId } = await authenticate(request);
        requirePublicKey();
        const { endpoint, keys } = validatePushSubscription(request.body);
        await subscriptions.save(currentMemberId, { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } });
        return reply.status(HttpStatus.NoContent).send();
      },
    );

    app.get(PREFERENCES_PATH, async (request) => {
      const { currentMemberId } = await authenticate(request);
      return preferences.find(currentMemberId);
    });

    app.put<{ Body: NotificationPreferences }>(
      PREFERENCES_PATH,
      { schema: { body: preferencesBodySchema } },
      async (request) => {
        const { currentMemberId } = await authenticate(request);
        const { chores, money, shopping } = request.body;
        await preferences.save(currentMemberId, { chores, money, shopping });
        return preferences.find(currentMemberId);
      },
    );

    // Succeeds even when the device was already gone, so turning off can always finish.
    app.delete<{ Body: { endpoint: string } }>(
      PUSH_SUBSCRIPTION_PATH,
      { schema: { body: endpointBodySchema } },
      async (request, reply) => {
        const { currentMemberId } = await authenticate(request);
        await subscriptions.remove(currentMemberId, request.body.endpoint);
        return reply.status(HttpStatus.NoContent).send();
      },
    );
  };
}
