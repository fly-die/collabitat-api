import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createColumn, createEntry } from "../../src/calendar/calendar.js";
import { PostgresCalendarRepository } from "../../src/calendar/calendar-repository.js";
import { connectDatabase } from "../../src/db/database.js";
import { createHousehold } from "../../src/households/household.js";
import { PostgresHouseholdRepository } from "../../src/households/postgres-household-repository.js";

const databaseUrl = process.env.TEST_DATABASE_URL;

describe.runIf(databaseUrl)("Postgres calendar", () => {
  let connection: Awaited<ReturnType<typeof connectDatabase>>;
  let calendar: PostgresCalendarRepository;
  let households: PostgresHouseholdRepository;

  beforeAll(async () => {
    connection = await connectDatabase(databaseUrl as string);
    households = new PostgresHouseholdRepository(connection.database);
    calendar = new PostgresCalendarRepository(connection.database);
  });

  afterAll(() => connection.close());

  it("keeps dates in order, edits them in place, and moves them to everyone with their column", async () => {
    const { household } = createHousehold("Langstrasse 12", "Mia");
    await households.save(household);
    const noah = createColumn([], "Noah");
    await calendar.addColumn(household.id, noah);
    const dentist = createEntry([noah], { title: "Dentist", day: "2026-11-05", time: "14:30", columnId: noah.id });
    const binDay = createEntry([noah], { title: "Bin day", day: "2026-11-05" });
    await calendar.saveEntry(household.id, dentist);
    await calendar.saveEntry(household.id, binDay);
    await calendar.saveEntry(household.id, { ...dentist, time: "15:00" });

    expect(await calendar.listEntries(household.id, "2026-11-01", "2026-11-30")).toEqual([binDay, { ...dentist, time: "15:00" }]);
    expect(await calendar.countEntriesFrom(household.id, noah.id, "2026-11-05")).toBe(1);
    expect(await calendar.countEntriesFrom(household.id, noah.id, "2026-11-06")).toBe(0);

    expect(await calendar.removeColumn(household.id, noah.id)).toBe(true);
    expect(await calendar.listColumns(household.id)).toEqual([]);
    expect((await calendar.findEntry(household.id, dentist.id))?.columnId).toBeNull();
    expect(await calendar.removeEntry(household.id, binDay.id)).toBe(true);
    expect(await calendar.removeEntry(household.id, binDay.id)).toBe(false);
  });
});
