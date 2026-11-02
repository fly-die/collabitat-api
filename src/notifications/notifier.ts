import type { FastifyBaseLogger } from "fastify";
import type { PushMessage, PushSender } from "./push-sender.js";
import type { PushSubscriptionRepository } from "./push-subscription-repository.js";

// Sends to every device of the given members. Never throws: a notification that can't be
// delivered must not break whatever the person was doing.
export function createNotifier(
  subscriptions: PushSubscriptionRepository,
  sender: PushSender | undefined,
  logger: Pick<FastifyBaseLogger, "warn">,
) {
  return async function notify(memberIds: string[], message: PushMessage) {
    if (!sender || memberIds.length === 0) {
      return;
    }
    try {
      const devices = await subscriptions.listByMembers(memberIds);
      await Promise.all(
        devices.map(async (device) => {
          const result = await sender.send(device, message);
          if (result === "gone") {
            await subscriptions.forget(device.endpoint);
          } else if (result === "failed") {
            logger.warn({ tag: message.tag }, "push notification failed");
          }
        }),
      );
    } catch (error) {
      logger.warn({ err: error }, "push notifications could not be sent");
    }
  };
}

export type Notify = ReturnType<typeof createNotifier>;
