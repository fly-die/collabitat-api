import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectDatabase } from "../../src/db/database.js";
import { addMember, createHousehold } from "../../src/households/household.js";
import { PostgresHouseholdRepository } from "../../src/households/postgres-household-repository.js";
import {
  PostgresPushSubscriptionRepository,
  PostgresReminderLog,
} from "../../src/notifications/postgres-push-subscription-repository.js";

const databaseUrl = process.env.TEST_DATABASE_URL;

describe.runIf(databaseUrl)("Postgres push subscriptions", () => {
  let connection: Awaited<ReturnType<typeof connectDatabase>>;
  let households: PostgresHouseholdRepository;
  let subscriptions: PostgresPushSubscriptionRepository;
  let reminderLog: PostgresReminderLog;

  beforeAll(async () => {
    connection = await connectDatabase(databaseUrl as string);
    households = new PostgresHouseholdRepository(connection.database);
    subscriptions = new PostgresPushSubscriptionRepository(connection.database);
    reminderLog = new PostgresReminderLog(connection.database);
  });

  afterAll(() => connection.close());

  it("keeps one row per device, removes only the owner's, and forgets gone ones", async () => {
    let household = createHousehold("Langstrasse 12", "Mia").household;
    await households.save(household);
    household = addMember(household, "Lea");
    await households.save(household);
    const [mia, lea] = household.members;
    const phone = { endpoint: `https://fcm.googleapis.com/fcm/send/${mia.id}`, keys: { p256dh: "old", auth: "old" } };

    await subscriptions.save(mia.id, phone);
    await subscriptions.save(mia.id, { ...phone, keys: { p256dh: "new", auth: "new" } });
    expect(await subscriptions.listByMembers([mia.id, lea.id])).toEqual([
      { ...phone, keys: { p256dh: "new", auth: "new" }, memberId: mia.id },
    ]);

    expect(await subscriptions.remove(lea.id, phone.endpoint)).toBe(false);
    expect(await subscriptions.remove(mia.id, phone.endpoint)).toBe(true);
    await subscriptions.save(lea.id, phone);
    await subscriptions.forget(phone.endpoint);
    expect(await subscriptions.listByMembers([mia.id, lea.id])).toEqual([]);
  });

  it("lets a member's reminder be claimed once per day", async () => {
    const household = createHousehold("Langstrasse 12", "Mia").household;
    await households.save(household);
    const [mia] = household.members;

    expect(await reminderLog.claim(mia.id, "2026-11-02")).toBe(true);
    expect(await reminderLog.claim(mia.id, "2026-11-02")).toBe(false);
    expect(await reminderLog.claim(mia.id, "2026-11-03")).toBe(true);
  });
});
