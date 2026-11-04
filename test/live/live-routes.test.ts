import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { LiveTopic, topicsOfPath } from "../../src/live/live-hub.js";
import { CLOSE_UNAUTHORIZED, LIVE_PATH } from "../../src/live/live-routes.js";
import { newCredentials } from "../support/credentials.js";

type App = ReturnType<typeof buildApp>;
type LiveSocket = Awaited<ReturnType<App["injectWS"]>>;

const authorized = (token: string) => ({ authorization: `Bearer ${token}` });

async function newHousehold(app: App, name: string) {
  const created = await app.inject({
    method: "POST",
    url: "/households",
    payload: { name, memberName: "Mia", ...newCredentials(name) },
  });
  return (created.json() as { token: string }).token;
}

// Collects what the server sends, so a test can wait for the next message or check that none came.
function listen(socket: LiveSocket) {
  const received: unknown[] = [];
  const waiting: ((message: unknown) => void)[] = [];
  socket.on("message", (data: Buffer) => {
    const message = JSON.parse(data.toString());
    const resolve = waiting.shift();
    if (resolve) {
      resolve(message);
    } else {
      received.push(message);
    }
  });
  return {
    received,
    next: () =>
      received.length > 0
        ? Promise.resolve(received.shift())
        : new Promise<unknown>((resolve) => waiting.push(resolve)),
  };
}

describe("live updates", () => {
  let app: App;

  beforeEach(async () => {
    app = buildApp();
    await app.ready();
  });

  afterEach(() => app.close());

  async function liveSocket(token: string) {
    const socket = await app.injectWS(LIVE_PATH);
    const messages = listen(socket);
    socket.send(JSON.stringify({ token }));
    expect(await messages.next()).toEqual({ type: "ready" });
    return { socket, messages };
  }

  it.each([
    ["/household/expenses/abc", [LiveTopic.Money]],
    ["/household/settlements", [LiveTopic.Money]],
    ["/household/tasks/abc/completions", [LiveTopic.Chores]],
    ["/household/shopping-trip?from=2026-11-02", [LiveTopic.Meals]],
    ["/household/shopping-trip/checkout?from=2026-11-02", [LiveTopic.Meals, LiveTopic.Money]],
    ["/household/calendar/entries/abc", [LiveTopic.Calendar]],
    ["/household/notes/done", [LiveTopic.Notes]],
    ["/household/members", [LiveTopic.Household]],
    ["/household?x=1", [LiveTopic.Household]],
    ["/households", []],
    ["/health", []],
  ])("files a change to %s under %s", (path, topics) => {
    expect(topicsOfPath(path)).toEqual(topics);
  });

  it("tells a household about its own changes, and only its own", async () => {
    const token = await newHousehold(app, "langstrasse");
    const otherToken = await newHousehold(app, "seefeld");
    const mine = await liveSocket(token);
    const other = await liveSocket(otherToken);

    await app.inject({
      method: "POST",
      url: "/household/tasks",
      headers: authorized(token),
      payload: { title: "Take out the trash", every: 1, unit: "week", firstDueOn: "2026-11-02" },
    });
    expect(await mine.messages.next()).toEqual({ type: "changed", topic: LiveTopic.Chores });

    await app.inject({ method: "POST", url: "/household/members", headers: authorized(token), payload: { name: "Lea" } });
    expect(await mine.messages.next()).toEqual({ type: "changed", topic: LiveTopic.Household });

    expect(other.messages.received).toEqual([]);
    mine.socket.terminate();
    other.socket.terminate();
  });

  it("stays quiet about reads and refused changes", async () => {
    const token = await newHousehold(app, "langstrasse");
    const mine = await liveSocket(token);

    await app.inject({ url: "/household/tasks", headers: authorized(token) });
    await app.inject({
      method: "POST",
      url: "/household/tasks",
      headers: authorized(token),
      payload: { title: "", every: 1, unit: "week", firstDueOn: "2026-11-02" },
    });

    expect(mine.messages.received).toEqual([]);
    mine.socket.terminate();
  });

  it("closes the connection when the first message isn't a valid session", async () => {
    const socket = await app.injectWS(LIVE_PATH);
    const closed = new Promise<number>((resolve) => socket.on("close", (code: number) => resolve(code)));

    socket.send(JSON.stringify({ token: "not-a-session" }));

    expect(await closed).toBe(CLOSE_UNAUTHORIZED);
  });
});
