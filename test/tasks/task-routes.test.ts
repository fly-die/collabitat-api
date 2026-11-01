import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { HttpStatus } from "../../src/http-status.js";
import { TaskErrorCode } from "../../src/tasks/task-errors.js";
import { newCredentials } from "../support/credentials.js";

type App = ReturnType<typeof buildApp>;

interface TasksView {
  tasks: {
    id: string;
    title: string;
    nextDueOn: string;
    lastCompletion: { id: string; doneOn: string; memberId: string } | null;
    rotation: string[];
    turnMemberId: string | null;
  }[];
}

const authorized = (token: string) => ({ authorization: `Bearer ${token}` });

async function newHousehold(app: App, name: string) {
  const created = await app.inject({
    method: "POST",
    url: "/households",
    payload: { name, memberName: "Mia", ...newCredentials(name) },
  });
  const { token } = created.json() as { token: string };
  const household = (await app.inject({ url: "/household", headers: authorized(token) })).json();
  return { token, household: household as { currentMemberId: string } };
}

describe("task routes", () => {
  let app: App;
  let token: string;
  let miaId: string;

  beforeEach(async () => {
    app = buildApp();
    const created = await newHousehold(app, "langstrasse");
    token = created.token;
    miaId = created.household.currentMemberId;
  });

  afterEach(() => app.close());

  function addTask(title: string, firstDueOn: string, every = 1, unit = "week", extra: Record<string, unknown> = {}) {
    return app.inject({
      method: "POST",
      url: "/household/tasks",
      headers: authorized(token),
      payload: { title, every, unit, firstDueOn, ...extra },
    });
  }

  function markDone(taskId: string, doneOn: string) {
    return app.inject({
      method: "POST",
      url: `/household/tasks/${taskId}/completions`,
      headers: authorized(token),
      payload: { doneOn },
    });
  }

  it("lists chores soonest first", async () => {
    await addTask("Water the plants", "2026-11-05");
    const response = await addTask("Take out the trash", "2026-11-02");

    expect(response.statusCode).toBe(HttpStatus.Created);
    const view: TasksView = response.json();
    expect(view.tasks.map((task) => [task.title, task.nextDueOn])).toEqual([
      ["Take out the trash", "2026-11-02"],
      ["Water the plants", "2026-11-05"],
    ]);
  });

  it("moves a chore one interval past when it was done, and undoing moves it back", async () => {
    const [trash] = ((await addTask("Take out the trash", "2026-11-02")).json() as TasksView).tasks;

    const done = await markDone(trash.id, "2026-11-04");

    expect(done.statusCode).toBe(HttpStatus.Created);
    const [afterDone] = (done.json() as TasksView).tasks;
    expect(afterDone).toEqual(
      expect.objectContaining({ nextDueOn: "2026-11-11", lastCompletion: expect.objectContaining({ doneOn: "2026-11-04", memberId: miaId }) }),
    );

    const undo = () =>
      app.inject({
        method: "DELETE",
        url: `/household/tasks/${trash.id}/completions/${afterDone.lastCompletion?.id}`,
        headers: authorized(token),
      });
    const [afterUndo] = ((await undo()).json() as TasksView).tasks;
    expect(afterUndo).toEqual(expect.objectContaining({ nextDueOn: "2026-11-02", lastCompletion: null }));
    expect((await undo()).json().error).toBe(TaskErrorCode.CompletionNotFound);
  });

  it("says whose turn it is, and passes it on when the chore is done", async () => {
    const lea = (
      await app.inject({ method: "POST", url: "/household/members", headers: authorized(token), payload: { name: "Lea" } })
    ).json().members[1];
    const [trash] = ((await addTask("Take out the trash", "2026-11-02")).json() as TasksView).tasks;
    expect(trash).toEqual(expect.objectContaining({ rotation: [miaId, lea.id], turnMemberId: miaId }));

    const [afterDone] = ((await markDone(trash.id, "2026-11-02")).json() as TasksView).tasks;
    expect(afterDone.turnMemberId).toBe(lea.id);

    const leaOnly = await addTask("Water the plants", "2026-11-03", 1, "week", { rotationMemberIds: [lea.id] });
    expect((leaOnly.json() as TasksView).tasks.find((task) => task.title === "Water the plants")).toEqual(expect.objectContaining({ rotation: [lea.id], turnMemberId: lea.id }));

    await app.inject({ method: "DELETE", url: `/household/members/${lea.id}`, headers: authorized(token) });
    const listed: TasksView = (await app.inject({ url: "/household/tasks", headers: authorized(token) })).json();
    expect(listed.tasks.map((task) => [task.title, task.turnMemberId])).toEqual([
      ["Water the plants", null],
      ["Take out the trash", miaId],
    ]);
  });

  it("won't let someone from another household take turns", async () => {
    const other = await newHousehold(app, "seefeld");

    const response = await addTask("Take out the trash", "2026-11-02", 1, "week", {
      rotationMemberIds: [other.household.currentMemberId],
    });

    expect(response.json().error).toBe(TaskErrorCode.InvalidRotation);
  });

  it("explains a chore it can't add", async () => {
    const response = await addTask("Take out the trash", "2026-11-02", 0);

    expect(response.statusCode).toBe(HttpStatus.BadRequest);
    expect(response.json().error).toBe(TaskErrorCode.InvalidInterval);
  });

  it("deletes a chore, and only in its own household", async () => {
    const [trash] = ((await addTask("Take out the trash", "2026-11-02")).json() as TasksView).tasks;
    const other = await newHousehold(app, "seefeld");
    const deleteTrash = (deleteToken: string) =>
      app.inject({ method: "DELETE", url: `/household/tasks/${trash.id}`, headers: authorized(deleteToken) });

    expect((await deleteTrash(other.token)).statusCode).toBe(HttpStatus.NotFound);
    const otherDone = await app.inject({
      method: "POST",
      url: `/household/tasks/${trash.id}/completions`,
      headers: authorized(other.token),
      payload: { doneOn: "2026-11-02" },
    });
    expect(otherDone.json().error).toBe(TaskErrorCode.TaskNotFound);

    const deleted = await deleteTrash(token);
    expect(deleted.statusCode).toBe(HttpStatus.Ok);
    expect(deleted.json()).toEqual({ tasks: [] });
  });

  it("needs a session", async () => {
    const response = await app.inject({ url: "/household/tasks" });

    expect(response.statusCode).toBe(HttpStatus.Unauthorized);
  });
});
