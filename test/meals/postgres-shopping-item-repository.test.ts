import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectDatabase } from "../../src/db/database.js";
import { createHousehold } from "../../src/households/household.js";
import { PostgresHouseholdRepository } from "../../src/households/postgres-household-repository.js";
import { PostgresShoppingItemRepository } from "../../src/meals/shopping-item-repository.js";

const databaseUrl = process.env.TEST_DATABASE_URL;

describe.runIf(databaseUrl)("Postgres shopping items", () => {
  let connection: Awaited<ReturnType<typeof connectDatabase>>;
  let items: PostgresShoppingItemRepository;
  let households: PostgresHouseholdRepository;

  beforeAll(async () => {
    connection = await connectDatabase(databaseUrl as string);
    households = new PostgresHouseholdRepository(connection.database);
    items = new PostgresShoppingItemRepository(connection.database);
  });

  afterAll(() => connection.close());

  it("keeps items in the order they were added and removes only its own", async () => {
    const household = createHousehold("Langstrasse 12", "Mia").household;
    const other = createHousehold("Seefeld 3", "Lea").household;
    await households.save(household);
    await households.save(other);
    const milk = { id: crypto.randomUUID(), line: "2 l Milch", createdAt: "2026-11-01T10:00:00.000Z" };
    const bread = { id: crypto.randomUUID(), line: "Zopf", createdAt: "2026-11-01T11:00:00.000Z" };

    await items.add(household.id, bread);
    await items.add(household.id, milk);

    expect(await items.list(household.id)).toEqual([milk, bread]);
    expect(await items.remove(other.id, milk.id)).toBe(false);
    expect(await items.remove(household.id, milk.id)).toBe(true);
    expect(await items.list(household.id)).toEqual([bread]);
  });
});
