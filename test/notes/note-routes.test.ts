import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../../src/app.js";
import { HttpStatus } from "../../src/http-status.js";
import { MAX_NOTE_LENGTH, NoteErrorCode } from "../../src/notes/note.js";
import { newCredentials } from "../support/credentials.js";

type App = ReturnType<typeof buildApp>;
const MINUTE = 60_000;

async function household(app: App, name: string) {
  const created = await app.inject({ method: "POST", url: "/households", payload: { name, memberName: "Mia", ...newCredentials(name) } });
  return (created.json() as { token: string }).token;
}

describe("note routes", () => {
  let app: App;
  let token: string;

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-04T10:00:00Z"));
    app = buildApp();
    token = await household(app, "langstrasse");
  });

  afterEach(async () => {
    await app.close();
    vi.useRealTimers();
  });

  const call = (method: "GET" | "PUT" | "POST" | "DELETE", url: string, payload?: object, as = token) =>
    app.inject({ method, url, headers: { authorization: `Bearer ${as}` }, payload });
  const texts = async () => (await call("GET", "/household/notes")).json().notes.map((note: { text: string; doneAt: string | null }) => [note.text, Boolean(note.doneAt)]);
  const add = async (text: string) => {
    vi.setSystemTime(Date.now() + MINUTE);
    return (await call("POST", "/household/notes", { text })).json().note;
  };

  it("lists open notes newest first, then ticked ones, with who wrote them", async () => {
    const { currentMemberId } = (await call("GET", "/household")).json();
    const wifi = await add("Wifi password is on the router");
    const bins = await add("Bins out on Monday");
    await add("Call the landlord about the heating");

    vi.setSystemTime(Date.now() + MINUTE);
    const ticked = await call("PUT", `/household/notes/${bins.id}/done`, { done: true });

    expect(ticked.json().note).toEqual({ ...bins, doneAt: expect.any(String) });
    expect(wifi.authorMemberId).toBe(currentMemberId);
    expect(await texts()).toEqual([
      ["Call the landlord about the heating", false],
      ["Wifi password is on the router", false],
      ["Bins out on Monday", true],
    ]);
    await call("PUT", `/household/notes/${bins.id}/done`, { done: false });
    expect(await texts()).toEqual([
      ["Call the landlord about the heating", false],
      ["Bins out on Monday", false],
      ["Wifi password is on the router", false],
    ]);
  });

  it("clears done notes and can put them back, still ticked", async () => {
    const milk = await add("Buy milk");
    await add("Water the plants");
    await call("PUT", `/household/notes/${milk.id}/done`, { done: true });

    const cleared = await call("DELETE", "/household/notes/done");
    expect(cleared.json().removed).toEqual([expect.objectContaining({ text: "Buy milk" })]);
    expect(await texts()).toEqual([["Water the plants", false]]);

    await call("POST", "/household/notes", { text: "Buy milk", done: true });
    expect(await texts()).toEqual([["Water the plants", false], ["Buy milk", true]]);
  });

  it("removes one note, refuses empty ones, and keeps other households out", async () => {
    const note = await add("Spare key is with Lea");
    const other = await household(app, "seefeld");

    const empty = await call("POST", "/household/notes", { text: "  " });
    const tooLong = await call("POST", "/household/notes", { text: "x".repeat(MAX_NOTE_LENGTH + 1) });
    expect([empty.json().error, tooLong.json().error]).toEqual([NoteErrorCode.InvalidText, NoteErrorCode.InvalidText]);
    expect((await call("DELETE", `/household/notes/${note.id}`, undefined, other)).statusCode).toBe(HttpStatus.NotFound);
    expect((await call("PUT", `/household/notes/${note.id}/done`, { done: true }, other)).statusCode).toBe(HttpStatus.NotFound);

    expect((await call("DELETE", `/household/notes/${note.id}`)).statusCode).toBe(HttpStatus.NoContent);
    expect(await texts()).toEqual([]);
  });
});
