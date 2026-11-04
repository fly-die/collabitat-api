import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectDatabase } from "../../src/db/database.js";
import { createHousehold } from "../../src/households/household.js";
import { PostgresHouseholdRepository } from "../../src/households/postgres-household-repository.js";
import { createNote } from "../../src/notes/note.js";
import { PostgresNoteRepository } from "../../src/notes/note-repository.js";

const databaseUrl = process.env.TEST_DATABASE_URL;

describe.runIf(databaseUrl)("Postgres notes", () => {
  let connection: Awaited<ReturnType<typeof connectDatabase>>;
  let notes: PostgresNoteRepository;
  let households: PostgresHouseholdRepository;

  beforeAll(async () => {
    connection = await connectDatabase(databaseUrl as string);
    households = new PostgresHouseholdRepository(connection.database);
    notes = new PostgresNoteRepository(connection.database);
  });

  afterAll(() => connection.close());

  it("ticks notes off and clears only the done ones", async () => {
    const { household } = createHousehold("Langstrasse 12", "Mia");
    await households.save(household);
    const [mia] = household.members;
    const milk = { ...createNote("Buy milk", mia.id), createdAt: "2026-11-04T10:00:00.000Z" };
    const plants = { ...createNote("Water the plants", mia.id), createdAt: "2026-11-04T10:01:00.000Z" };
    await notes.add(household.id, milk);
    await notes.add(household.id, plants);

    const ticked = await notes.setDoneAt(household.id, milk.id, "2026-11-04T11:00:00.000Z");

    expect(ticked).toEqual({ ...milk, doneAt: "2026-11-04T11:00:00.000Z" });
    expect(await notes.list(household.id)).toEqual([plants, ticked]);
    expect(await notes.removeDone(household.id)).toEqual([ticked]);
    expect(await notes.list(household.id)).toEqual([plants]);
    expect(await notes.setDoneAt(household.id, milk.id, null)).toBeUndefined();
    expect(await notes.remove(household.id, plants.id)).toBe(true);
  });
});
