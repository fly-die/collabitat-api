import { WebPushError } from "web-push";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WebPushSender } from "../../src/notifications/push-sender.js";

const sendNotification = vi.fn();

const keys = { publicKey: "public", privateKey: "private", subject: "https://example.com" };
const device = { endpoint: "https://fcm.googleapis.com/fcm/send/a", keys: { p256dh: "p", auth: "a" } };
const message = { title: "Your turn today", body: "Take out the trash", tag: "chores-2026-11-02" };

const pushError = (statusCode: number) => new WebPushError("push failed", statusCode, {}, "", device.endpoint);
// A push service that answers with this error.
const failingWith = (error: Error) =>
  (async () => {
    throw error;
  }) as unknown as ConstructorParameters<typeof WebPushSender>[1];

describe("web push sender", () => {
  beforeEach(() => sendNotification.mockReset());

  it("sends the message with the server's keys and a time limit", async () => {
    sendNotification.mockResolvedValue({ statusCode: 201 });

    expect(await new WebPushSender(keys, sendNotification).send(device, message)).toBe("sent");
    expect(sendNotification).toHaveBeenCalledWith(device, JSON.stringify(message), {
      vapidDetails: keys,
      TTL: expect.any(Number),
    });
  });

  it.each([
    [404, "gone"],
    [410, "gone"],
    [500, "failed"],
  ])("reads a %i from the push service as %s", async (statusCode, result) => {
    expect(await new WebPushSender(keys, failingWith(pushError(statusCode))).send(device, message)).toBe(result);
  });

  it("treats a network error as failed", async () => {
    expect(await new WebPushSender(keys, failingWith(new Error("socket hang up"))).send(device, message)).toBe("failed");
  });
});
