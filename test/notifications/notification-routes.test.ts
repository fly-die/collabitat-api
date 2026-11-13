import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../../src/app.js";
import { HttpStatus } from "../../src/http-status.js";
import type { PushMessage, PushResult, PushSender } from "../../src/notifications/push-sender.js";
import { NotificationErrorCode, type PushSubscription } from "../../src/notifications/push-subscription.js";
import { InMemoryNotificationPreferenceRepository } from "../../src/notifications/notification-preferences.js";
import { InMemoryPushSubscriptionRepository } from "../../src/notifications/push-subscription-repository.js";
import { newCredentials } from "../support/credentials.js";

const device = (id: string): PushSubscription => ({
  endpoint: `https://fcm.googleapis.com/fcm/send/${id}`,
  keys: { p256dh: `p256dh-${id}`, auth: `auth-${id}` },
});

function fakeSender(result: PushResult = "sent") {
  const sent: { endpoint: string; message: PushMessage }[] = [];
  const sender: PushSender = {
    publicKey: "test-public-key",
    send: vi.fn(async (subscription: PushSubscription, message: PushMessage) => {
      sent.push({ endpoint: subscription.endpoint, message });
      return result;
    }),
  };
  return { sender, sent };
}

const authorized = (token: string) => ({ authorization: `Bearer ${token}` });

async function householdWithLea(app: ReturnType<typeof buildApp>) {
  const created = await app.inject({
    method: "POST",
    url: "/households",
    payload: { name: "Langstrasse 12", memberName: "Mia", ...newCredentials("mia") },
  });
  const { token } = created.json() as { token: string };
  const added = await app.inject({ method: "POST", url: "/household/members", headers: authorized(token), payload: { name: "Lea" } });
  const [mia, lea] = added.json().members as { id: string }[];
  return { token, mia, lea };
}

describe("notification routes", () => {
  let app: ReturnType<typeof buildApp>;

  afterEach(() => app.close());

  it("says notifications are off when the server has no push keys", async () => {
    app = buildApp();
    const { token } = await householdWithLea(app);

    const key = await app.inject({ url: "/push/public-key" });
    const saved = await app.inject({ method: "PUT", url: "/household/push-subscription", headers: authorized(token), payload: device("a") });

    expect(key.statusCode).toBe(HttpStatus.NotFound);
    expect(key.json().error).toBe(NotificationErrorCode.PushDisabled);
    expect(saved.json().error).toBe(NotificationErrorCode.PushDisabled);
  });

  it("saves this device, turns it off again, and stays quiet about it to the flatmates' screens", async () => {
    const { sender } = fakeSender();
    const subscriptions = new InMemoryPushSubscriptionRepository();
    app = buildApp({ pushSender: sender, pushSubscriptionRepository: subscriptions });
    const { token, mia } = await householdWithLea(app);

    expect((await app.inject({ url: "/push/public-key" })).json()).toEqual({ publicKey: "test-public-key" });
    const saved = await app.inject({ method: "PUT", url: "/household/push-subscription", headers: authorized(token), payload: device("a") });
    expect(saved.statusCode).toBe(HttpStatus.NoContent);
    expect(await subscriptions.listAll()).toEqual([{ ...device("a"), memberId: mia.id }]);

    const removeTwice = () =>
      app.inject({ method: "DELETE", url: "/household/push-subscription", headers: authorized(token), payload: { endpoint: device("a").endpoint } });
    expect((await removeTwice()).statusCode).toBe(HttpStatus.NoContent);
    expect((await removeTwice()).statusCode).toBe(HttpStatus.NoContent);
    expect(await subscriptions.listAll()).toEqual([]);
  });

  it.each([
    ["a made-up host", "https://push.example.com/send/a"],
    ["plain http", "http://fcm.googleapis.com/fcm/send/a"],
    ["a local address", "https://localhost/send/a"],
    ["a host that only looks similar", "https://fcm.googleapis.com.example.com/send/a"],
    ["an odd port", "https://fcm.googleapis.com:8443/send/a"],
    ["not a URL", "fcm.googleapis.com"],
  ])("refuses %s as a notification address", async (_label, endpoint) => {
    const { sender } = fakeSender();
    app = buildApp({ pushSender: sender });
    const { token } = await householdWithLea(app);

    const response = await app.inject({
      method: "PUT",
      url: "/household/push-subscription",
      headers: authorized(token),
      payload: { ...device("a"), endpoint },
    });

    expect(response.statusCode).toBe(HttpStatus.BadRequest);
    expect(response.json().error).toBe(NotificationErrorCode.InvalidSubscription);
  });

  it("tells the flatmates who share a new expense, but not the one who added it", async () => {
    const { sender, sent } = fakeSender();
    const subscriptions = new InMemoryPushSubscriptionRepository();
    app = buildApp({ pushSender: sender, pushSubscriptionRepository: subscriptions });
    const { token, mia, lea } = await householdWithLea(app);
    await subscriptions.save(mia.id, device("mia"));
    await subscriptions.save(lea.id, device("lea"));

    await app.inject({
      method: "POST",
      url: "/household/expenses",
      headers: authorized(token),
      payload: { description: "Groceries", amountCents: 3000, paidByMemberId: mia.id, splitBetweenMemberIds: [mia.id, lea.id], spentOn: "2026-11-02" },
    });

    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toEqual({
      endpoint: device("lea").endpoint,
      message: { title: "Mia added Groceries", body: "Your share: CHF 15.00", tag: expect.stringMatching(/^expense-/) },
    });
  });

  it("forgets a device the push service says is gone", async () => {
    const { sender } = fakeSender("gone");
    const subscriptions = new InMemoryPushSubscriptionRepository();
    app = buildApp({ pushSender: sender, pushSubscriptionRepository: subscriptions });
    const { token, mia, lea } = await householdWithLea(app);
    await subscriptions.save(lea.id, device("lea"));

    await app.inject({
      method: "POST",
      url: "/household/expenses",
      headers: authorized(token),
      payload: { description: "Groceries", amountCents: 3000, paidByMemberId: mia.id, splitBetweenMemberIds: [mia.id, lea.id], spentOn: "2026-11-02" },
    });

    await vi.waitFor(async () => expect(await subscriptions.listAll()).toEqual([]));
  });

  it("lets a member switch kinds off for themselves, and refuses half an answer", async () => {
    app = buildApp();
    const { token } = await householdWithLea(app);
    const url = "/household/notification-preferences";

    const before = await app.inject({ url, headers: authorized(token) });
    const saved = await app.inject({ method: "PUT", url, headers: authorized(token), payload: { chores: true, money: false, shopping: true } });
    const partial = await app.inject({ method: "PUT", url, headers: authorized(token), payload: { money: false } });
    const after = await app.inject({ url, headers: authorized(token) });

    expect(before.json()).toEqual({ chores: true, money: true, shopping: true });
    expect(saved.json()).toEqual({ chores: true, money: false, shopping: true });
    expect(partial.statusCode).toBe(HttpStatus.BadRequest);
    expect(after.json()).toEqual({ chores: true, money: false, shopping: true });
  });

  it("stays quiet about an expense for a flatmate who switched money off", async () => {
    const { sender, sent } = fakeSender();
    const subscriptions = new InMemoryPushSubscriptionRepository();
    const preferences = new InMemoryNotificationPreferenceRepository();
    app = buildApp({ pushSender: sender, pushSubscriptionRepository: subscriptions, notificationPreferenceRepository: preferences });
    const { token, mia, lea } = await householdWithLea(app);
    await subscriptions.save(lea.id, device("lea"));
    await preferences.save(lea.id, { chores: true, money: false, shopping: true });

    await app.inject({
      method: "POST",
      url: "/household/expenses",
      headers: authorized(token),
      payload: { description: "Groceries", amountCents: 3000, paidByMemberId: mia.id, splitBetweenMemberIds: [mia.id, lea.id], spentOn: "2026-11-04" },
    });
    await app.inject({ method: "POST", url: "/household/shopping-trip?from=2026-11-09", headers: authorized(token) });

    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].message.title).toBe("Mia is shopping");
  });

  it("tells the flatmates when someone starts shopping, but not the shopper", async () => {
    const { sender, sent } = fakeSender();
    const subscriptions = new InMemoryPushSubscriptionRepository();
    app = buildApp({ pushSender: sender, pushSubscriptionRepository: subscriptions });
    const { token, mia, lea } = await householdWithLea(app);
    await subscriptions.save(mia.id, device("mia"));
    await subscriptions.save(lea.id, device("lea"));

    await app.inject({ method: "POST", url: "/household/shopping-trip?from=2026-11-09", headers: authorized(token) });

    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toEqual({
      endpoint: device("lea").endpoint,
      message: { title: "Mia is shopping", body: "Add what you need to the list now.", tag: expect.stringMatching(/^shopping-/) },
    });
  });
});
