import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectDatabase } from "../../src/db/database.js";
import {
  addMember,
  createHousehold,
  joinAsExistingMember,
  removeMember,
} from "../../src/households/household.js";
import { PostgresHouseholdRepository } from "../../src/households/postgres-household-repository.js";
import { PostgresSessionRepository } from "../../src/sessions/postgres-session-repository.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const UNKNOWN_ID = "00000000-0000-0000-0000-000000000000";

describe.runIf(databaseUrl)("Postgres repositories", () => {
  let connection: Awaited<ReturnType<typeof connectDatabase>>;
  let households: PostgresHouseholdRepository;
  let sessions: PostgresSessionRepository;

  beforeAll(async () => {
    connection = await connectDatabase(databaseUrl as string);
    households = new PostgresHouseholdRepository(connection.database);
    sessions = new PostgresSessionRepository(connection.database);
  });

  afterAll(() => connection.close());

  it("persists members in order, their joined state and removals", async () => {
    const created = createHousehold("Langstrasse 12", "Mia");
    const mia = created.member;
    let household = created.household;
    await households.save(household);

    household = addMember(household, "Lea");
    household = addMember(household, "Noah");
    await households.save(household);
    household = joinAsExistingMember(household, household.members[2].id).household;
    household = removeMember(household, household.members[1].id, mia.id);
    await households.save(household);

    const stored = await households.findByInviteCode(household.inviteCode);
    expect(stored).toEqual(household);
    expect(stored?.members.map(({ name, hasJoined }) => [name, hasJoined])).toEqual([
      ["Mia", true],
      ["Noah", true],
    ]);
    expect(await households.findByMemberId(mia.id)).toEqual(household);
  });

  it("ends a member's sessions when the member is removed", async () => {
    const { household, member: mia } = createHousehold("Flat", "Mia");
    const withLea = addMember(household, "Lea");
    await households.save(withLea);
    const lea = withLea.members[1];
    await sessions.create(`hash-${lea.id}`, lea.id);
    expect(await sessions.findMemberId(`hash-${lea.id}`)).toBe(lea.id);

    await households.save(removeMember(withLea, lea.id, mia.id));

    expect(await sessions.findMemberId(`hash-${lea.id}`)).toBeUndefined();
  });

  it("returns undefined for unknown codes, members and sessions", async () => {
    expect(await households.findByInviteCode("missing")).toBeUndefined();
    expect(await households.findByMemberId(UNKNOWN_ID)).toBeUndefined();
    expect(await sessions.findMemberId("missing")).toBeUndefined();
  });
});
