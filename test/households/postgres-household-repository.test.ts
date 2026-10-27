import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectDatabase } from "../../src/db/database.js";
import { addMember, createHousehold, removeMember } from "../../src/households/household.js";
import { PostgresHouseholdRepository } from "../../src/households/postgres-household-repository.js";

const databaseUrl = process.env.TEST_DATABASE_URL;

describe.runIf(databaseUrl)("PostgresHouseholdRepository", () => {
  let connection: Awaited<ReturnType<typeof connectDatabase>>;
  let repository: PostgresHouseholdRepository;

  beforeAll(async () => {
    connection = await connectDatabase(databaseUrl as string);
    repository = new PostgresHouseholdRepository(connection.database);
  });

  afterAll(() => connection.close());

  it("persists members in the order they were added and applies removals", async () => {
    let household = createHousehold("Langstrasse 12");
    await repository.save(household);

    household = addMember(household, "Lea");
    await repository.save(household);
    household = addMember(household, "Noah");
    await repository.save(household);
    household = removeMember(household, household.members[0].id);
    await repository.save(household);
    household = addMember(household, "Lea");
    await repository.save(household);

    const stored = await repository.findById(household.id);
    expect(stored?.name).toBe("Langstrasse 12");
    expect(stored?.members.map((member) => member.name)).toEqual(["Noah", "Lea"]);
  });

  it("returns undefined for an unknown household", async () => {
    expect(await repository.findById("00000000-0000-0000-0000-000000000000")).toBeUndefined();
  });
});
