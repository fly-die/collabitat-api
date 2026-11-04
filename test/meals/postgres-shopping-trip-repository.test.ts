import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectDatabase } from "../../src/db/database.js";
import { createHousehold } from "../../src/households/household.js";
import { PostgresHouseholdRepository } from "../../src/households/postgres-household-repository.js";
import { PostgresShoppingTripRepository } from "../../src/meals/shopping-trip-repository.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const MONDAY = "2026-11-02";
const NEXT_MONDAY = "2026-11-09";

describe.runIf(databaseUrl)("Postgres shopping trips", () => {
  let connection: Awaited<ReturnType<typeof connectDatabase>>;
  let trips: PostgresShoppingTripRepository;
  let households: PostgresHouseholdRepository;

  beforeAll(async () => {
    connection = await connectDatabase(databaseUrl as string);
    households = new PostgresHouseholdRepository(connection.database);
    trips = new PostgresShoppingTripRepository(connection.database);
  });

  afterAll(() => connection.close());

  it("keeps the first shopper until the trip ends", async () => {
    const { household } = createHousehold("Langstrasse 12", "Mia");
    await households.save(household);
    const [mia] = household.members;
    const first = { shopperMemberId: mia.id, from: MONDAY, startedAt: "2026-11-04T17:00:00.000Z" };

    await trips.start(household.id, first);
    await trips.start(household.id, { ...first, from: NEXT_MONDAY, startedAt: "2026-11-04T17:05:00.000Z" });

    expect(await trips.find(household.id)).toEqual(first);
    await trips.end(household.id);
    expect(await trips.find(household.id)).toBeUndefined();
  });

  it("keeps ticks per week, and ticking twice is the same as once", async () => {
    const { household } = createHousehold("Seefeld 3", "Lea");
    await households.save(household);

    await trips.setChecked(household.id, MONDAY, "dinner:pasta|g", true);
    await trips.setChecked(household.id, MONDAY, "dinner:pasta|g", true);
    await trips.setChecked(household.id, MONDAY, "extra:zopf", true);
    await trips.setChecked(household.id, NEXT_MONDAY, "dinner:reis|g", true);
    await trips.setChecked(household.id, MONDAY, "extra:zopf", false);

    expect(await trips.listChecked(household.id, MONDAY)).toEqual(["dinner:pasta|g"]);
    expect(await trips.listChecked(household.id, NEXT_MONDAY)).toEqual(["dinner:reis|g"]);
  });
});
