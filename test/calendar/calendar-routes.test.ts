import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../../src/app.js";
import { CalendarErrorCode } from "../../src/calendar/calendar.js";
import { HttpStatus } from "../../src/http-status.js";
import { newCredentials } from "../support/credentials.js";

type App = ReturnType<typeof buildApp>;
const TODAY = "2026-11-04";

async function household(app: App, name: string) {
  const created = await app.inject({ method: "POST", url: "/households", payload: { name, memberName: "Mia", ...newCredentials(name) } });
  return (created.json() as { token: string }).token;
}

describe("calendar routes", () => {
  let app: App;
  let token: string;

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(`${TODAY}T10:00:00Z`));
    app = buildApp();
    token = await household(app, "langstrasse");
  });

  afterEach(async () => {
    await app.close();
    vi.useRealTimers();
  });

  const call = (method: "GET" | "PUT" | "POST" | "DELETE", url: string, payload?: object, as = token) =>
    app.inject({ method, url, headers: { authorization: `Bearer ${as}` }, payload });
  const calendar = async (from = TODAY, as = token) => (await call("GET", `/household/calendar?from=${from}`, undefined, as)).json();

  it("shows four weeks of dates in their columns, whole-day dates first", async () => {
    const { column: noah } = (await call("POST", "/household/calendar/columns", { name: " Noah " })).json();
    await call("POST", "/household/calendar/entries", { title: "Dentist", day: "2026-11-05", time: "14:30", columnId: noah.id });
    await call("POST", "/household/calendar/entries", { title: "Bin day", day: "2026-11-05" });
    await call("POST", "/household/calendar/entries", { title: "Too far ahead", day: "2026-12-02" });

    expect(await calendar()).toEqual({
      from: TODAY,
      to: "2026-12-01",
      columns: [expect.objectContaining({ name: "Noah" })],
      entries: [
        expect.objectContaining({ title: "Bin day", day: "2026-11-05", time: null, columnId: null }),
        expect.objectContaining({ title: "Dentist", day: "2026-11-05", time: "14:30", columnId: noah.id }),
      ],
    });
  });

  it("refuses unclear dates and columns with a message to show", async () => {
    await call("POST", "/household/calendar/columns", { name: "Family" });

    const cases = [
      [await call("POST", "/household/calendar/columns", { name: "family" }), CalendarErrorCode.InvalidColumnName],
      [await call("POST", "/household/calendar/entries", { title: " ", day: TODAY }), CalendarErrorCode.InvalidTitle],
      [await call("POST", "/household/calendar/entries", { title: "Party", day: "2026-02-30" }), CalendarErrorCode.InvalidDay],
      [await call("POST", "/household/calendar/entries", { title: "Party", day: TODAY, time: "25:00" }), CalendarErrorCode.InvalidTime],
      [await call("POST", "/household/calendar/entries", { title: "Party", day: TODAY, columnId: crypto.randomUUID() }), CalendarErrorCode.UnknownColumn],
    ] as const;

    for (const [response, code] of cases) {
      expect(response.statusCode).toBe(HttpStatus.BadRequest);
      expect(response.json()).toEqual({ error: code, message: expect.any(String) });
    }
  });

  it("edits and removes dates, and keeps other households out", async () => {
    const { column: noah } = (await call("POST", "/household/calendar/columns", { name: "Noah" })).json();
    const { entry } = (await call("POST", "/household/calendar/entries", { title: "Dentist", day: TODAY })).json();
    const other = await household(app, "seefeld");

    const moved = await call("PUT", `/household/calendar/entries/${entry.id}`, { title: "Dentist", day: "2026-11-06", time: "09:15", columnId: noah.id });
    expect(moved.json().entry).toEqual({ ...entry, day: "2026-11-06", time: "09:15", columnId: noah.id });
    expect((await call("DELETE", `/household/calendar/entries/${entry.id}`, undefined, other)).statusCode).toBe(HttpStatus.NotFound);
    expect((await calendar(TODAY, other)).entries).toEqual([]);

    expect((await call("DELETE", `/household/calendar/entries/${entry.id}`)).statusCode).toBe(HttpStatus.NoContent);
    expect((await calendar()).entries).toEqual([]);
  });

  it("keeps a column with upcoming dates, and moves its past dates to everyone when removed", async () => {
    const { column: noah } = (await call("POST", "/household/calendar/columns", { name: "Noah" })).json();
    await call("POST", "/household/calendar/entries", { title: "School trip", day: "2026-11-02", columnId: noah.id });
    const { entry: upcoming } = (await call("POST", "/household/calendar/entries", { title: "Dentist", day: TODAY, columnId: noah.id })).json();

    const refused = await call("DELETE", `/household/calendar/columns/${noah.id}`);
    expect(refused.statusCode).toBe(HttpStatus.Conflict);
    expect(refused.json().message).toBe("Noah still has 1 upcoming date. Move or remove them first.");

    await call("DELETE", `/household/calendar/entries/${upcoming.id}`);
    expect((await call("DELETE", `/household/calendar/columns/${noah.id}`)).statusCode).toBe(HttpStatus.NoContent);
    const past = await calendar("2026-11-02");
    expect(past.columns).toEqual([]);
    expect(past.entries).toEqual([expect.objectContaining({ title: "School trip", columnId: null })]);
  });
});
