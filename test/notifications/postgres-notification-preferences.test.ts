import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectDatabase } from "../../src/db/database.js";
import { addMember, createHousehold } from "../../src/households/household.js";
import { PostgresHouseholdRepository } from "../../src/households/postgres-household-repository.js";
import { PostgresNotificationPreferenceRepository } from "../../src/notifications/notification-preferences.js";

const databaseUrl = process.env.TEST_DATABASE_URL;

describe.runIf(databaseUrl)("Postgres notification preferences", () => {
  let connection: Awaited<ReturnType<typeof connectDatabase>>;
  let preferences: PostgresNotificationPreferenceRepository;
  let households: PostgresHouseholdRepository;

  beforeAll(async () => {
    connection = await connectDatabase(databaseUrl as string);
    households = new PostgresHouseholdRepository(connection.database);
    preferences = new PostgresNotificationPreferenceRepository(connection.database);
  });

  afterAll(() => connection.close());

  it("keeps every kind on until a member switches it off, and back on again", async () => {
    const household = addMember(createHousehold("Langstrasse 12", "Mia").household, "Lea");
    await households.save(household);
    const [mia, lea] = household.members;

    await preferences.save(lea.id, { chores: true, money: false, shopping: false });

    expect(await preferences.find(mia.id)).toEqual({ chores: true, money: true, shopping: true });
    expect(await preferences.find(lea.id)).toEqual({ chores: true, money: false, shopping: false });
    expect(await preferences.listening([mia.id, lea.id], "money")).toEqual([mia.id]);
    expect(await preferences.listening([mia.id, lea.id], "chores")).toEqual([mia.id, lea.id]);

    await preferences.save(lea.id, { chores: true, money: true, shopping: false });

    expect(await preferences.listening([mia.id, lea.id], "money")).toEqual([mia.id, lea.id]);
  });
});
