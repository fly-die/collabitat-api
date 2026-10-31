import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectDatabase } from "../../src/db/database.js";
import { PostgresSettlementRepository } from "../../src/expenses/postgres-settlement-repository.js";
import { createSettlement } from "../../src/expenses/settlement.js";
import { addMember, createHousehold } from "../../src/households/household.js";
import { PostgresHouseholdRepository } from "../../src/households/postgres-household-repository.js";

const databaseUrl = process.env.TEST_DATABASE_URL;

describe.runIf(databaseUrl)("Postgres settlement repository", () => {
  let connection: Awaited<ReturnType<typeof connectDatabase>>;
  let households: PostgresHouseholdRepository;
  let settlements: PostgresSettlementRepository;

  beforeAll(async () => {
    connection = await connectDatabase(databaseUrl as string);
    households = new PostgresHouseholdRepository(connection.database);
    settlements = new PostgresSettlementRepository(connection.database);
  });

  afterAll(() => connection.close());

  it("stores payments newest first and removes them only from their own household", async () => {
    const household = addMember(createHousehold("Langstrasse 12", "Mia").household, "Lea");
    const other = createHousehold("Mittagweg 4", "Noah").household;
    await households.save(household);
    await households.save(other);
    const [mia, lea] = household.members;
    const payment = (amountCents: number, settledOn: string) =>
      createSettlement(household, { fromMemberId: lea.id, toMemberId: mia.id, amountCents, settledOn });
    const older = payment(500, "2026-10-01");
    const newer = payment(1000, "2026-10-31");
    await settlements.add(household.id, older);
    await settlements.add(household.id, newer);

    expect(await settlements.listByHousehold(household.id)).toEqual([newer, older]);
    expect(await settlements.remove(other.id, older.id)).toBe(false);
    expect(await settlements.remove(household.id, older.id)).toBe(true);
    expect(await settlements.listByHousehold(household.id)).toEqual([newer]);
  });
});
