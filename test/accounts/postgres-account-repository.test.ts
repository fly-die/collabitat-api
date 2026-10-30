import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAccount } from "../../src/accounts/account.js";
import { PostgresAccountRepository } from "../../src/accounts/postgres-account-repository.js";
import { connectDatabase } from "../../src/db/database.js";
import { addMember, createHousehold, removeMember } from "../../src/households/household.js";
import { PostgresHouseholdRepository } from "../../src/households/postgres-household-repository.js";
import { newCredentials } from "../support/credentials.js";

const databaseUrl = process.env.TEST_DATABASE_URL;

describe.runIf(databaseUrl)("Postgres account repository", () => {
  let connection: Awaited<ReturnType<typeof connectDatabase>>;
  let households: PostgresHouseholdRepository;
  let accounts: PostgresAccountRepository;

  beforeAll(async () => {
    connection = await connectDatabase(databaseUrl as string);
    households = new PostgresHouseholdRepository(connection.database);
    accounts = new PostgresAccountRepository(connection.database);
  });

  afterAll(() => connection.close());

  it("links an account to its member and keeps the link when the household is saved again", async () => {
    const { household, member } = createHousehold("Langstrasse 12", "Mia");
    await households.save(household);
    const account = await createAccount(newCredentials("mia"));

    await accounts.createForMember(account, member.id);
    await households.save(addMember(household, "Lea"));

    expect(await accounts.findByEmail(account.email)).toEqual(account);
    expect(await accounts.findMemberIds(account.id)).toEqual([member.id]);
    expect(await accounts.hasAccount(member.id)).toBe(true);
  });

  it("keeps the account when its member is removed", async () => {
    const created = createHousehold("Langstrasse 12", "Mia");
    const withLea = addMember(created.household, "Lea");
    await households.save(withLea);
    const lea = withLea.members[1];
    const account = await createAccount(newCredentials("lea"));
    await accounts.createForMember(account, lea.id);

    await households.save(removeMember(withLea, lea.id, created.member.id));

    expect(await accounts.findByEmail(account.email)).toEqual(account);
    expect(await accounts.findMemberIds(account.id)).toEqual([]);
  });

  it("refuses a second account with the same email", async () => {
    const { household, member } = createHousehold("Langstrasse 12", "Mia");
    const withLea = addMember(household, "Lea");
    await households.save(withLea);
    const credentials = newCredentials("mia");
    await accounts.createForMember(await createAccount(credentials), member.id);

    await expect(
      accounts.createForMember(await createAccount(credentials), withLea.members[1].id),
    ).rejects.toThrow();
    expect(await accounts.hasAccount(withLea.members[1].id)).toBe(false);
  });
});
