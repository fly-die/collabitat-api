import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectDatabase } from "../../src/db/database.js";
import { addMember, createHousehold } from "../../src/households/household.js";
import { PostgresHouseholdRepository } from "../../src/households/postgres-household-repository.js";
import { createCompletion, createRecurringTask } from "../../src/tasks/recurring-task.js";
import { PostgresTaskRepository } from "../../src/tasks/postgres-task-repository.js";

const databaseUrl = process.env.TEST_DATABASE_URL;

describe.runIf(databaseUrl)("Postgres task repository", () => {
  let connection: Awaited<ReturnType<typeof connectDatabase>>;
  let households: PostgresHouseholdRepository;
  let tasks: PostgresTaskRepository;

  beforeAll(async () => {
    connection = await connectDatabase(databaseUrl as string);
    households = new PostgresHouseholdRepository(connection.database);
    tasks = new PostgresTaskRepository(connection.database);
  });

  afterAll(() => connection.close());

  async function savedHousehold() {
    let household = createHousehold("Langstrasse 12", "Mia").household;
    await households.save(household);
    household = addMember(household, "Lea");
    await households.save(household);
    return household;
  }

  it("stores tasks with their completions, latest first, only in their own household", async () => {
    const household = await savedHousehold();
    const other = await savedHousehold();
    const [mia, lea] = household.members;
    const trash = createRecurringTask(
      { title: "Take out the trash", every: 1, unit: "week", firstDueOn: "2026-11-02", rotationMemberIds: [lea.id, mia.id] },
      [mia.id, lea.id],
    );
    const earlier = createCompletion(mia.id, "2026-11-02");
    const later = createCompletion(mia.id, "2026-11-09");

    await tasks.add(household.id, trash);
    await tasks.addCompletion(trash.id, earlier);
    await tasks.addCompletion(trash.id, later);

    expect(await tasks.listByHousehold(household.id)).toEqual([{ ...trash, completions: [later, earlier] }]);
    expect(await tasks.find(other.id, trash.id)).toBeUndefined();
    expect(await tasks.removeCompletion(trash.id, later.id)).toBe(true);
    expect((await tasks.find(household.id, trash.id))?.completions).toEqual([earlier]);
    expect(await tasks.remove(other.id, trash.id)).toBe(false);
    expect(await tasks.remove(household.id, trash.id)).toBe(true);
    expect(await tasks.listByHousehold(household.id)).toEqual([]);
  });

  it("changes a task and its turns without touching what was done", async () => {
    const household = await savedHousehold();
    const [mia, lea] = household.members;
    const memberIds = [mia.id, lea.id];
    const trash = createRecurringTask({ title: "Trash", every: 1, unit: "week", firstDueOn: "2026-11-02" }, memberIds);
    const done = createCompletion(mia.id, "2026-11-02");
    await tasks.add(household.id, trash);
    await tasks.addCompletion(trash.id, done);

    const changed = createRecurringTask(
      { title: "Recycling", every: 2, unit: "month", firstDueOn: "2026-11-03", rotationMemberIds: [lea.id] },
      memberIds,
      { ...trash, completions: [done] },
    );
    await tasks.update(household.id, changed);

    expect(await tasks.find(household.id, trash.id)).toEqual(changed);
    expect(changed.completions).toEqual([done]);
  });
});
