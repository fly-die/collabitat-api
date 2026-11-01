import { describe, expect, it } from "vitest";
import {
  addInterval,
  createCompletion,
  createRecurringTask,
  nextDueOn,
  turnOf,
  type NewRecurringTask,
} from "../../src/tasks/recurring-task.js";
import { TaskErrorCode } from "../../src/tasks/task-errors.js";

const flatmates = ["mia", "lea", "noah"];
const weeklyTrash: NewRecurringTask = { title: "  Take out   the trash ", every: 1, unit: "week", firstDueOn: "2026-11-02" };

describe("recurring task", () => {
  it.each([
    ["2026-11-01", { every: 3, unit: "day" as const }, "2026-11-04"],
    ["2026-11-01", { every: 2, unit: "week" as const }, "2026-11-15"],
    ["2026-12-15", { every: 1, unit: "month" as const }, "2027-01-15"],
    ["2026-01-31", { every: 1, unit: "month" as const }, "2026-02-28"],
    ["2028-01-31", { every: 1, unit: "month" as const }, "2028-02-29"],
    ["2026-03-31", { every: 6, unit: "month" as const }, "2026-09-30"],
  ])("adds to %s every %o and lands on %s", (from, interval, expected) => {
    expect(addInterval(from, interval)).toBe(expected);
  });

  it("is first due when it was planned, then one interval after it was last done", () => {
    const task = createRecurringTask(weeklyTrash, flatmates);
    expect(task.title).toBe("Take out the trash");
    expect(nextDueOn(task)).toBe("2026-11-02");

    const doneLate = createCompletion("member-1", "2026-11-05");
    const doneEarlierButRecordedLater = createCompletion("member-2", "2026-11-03");

    expect(nextDueOn({ ...task, completions: [doneEarlierButRecordedLater, doneLate] })).toBe("2026-11-12");
  });

  it.each([
    ["an empty title", { title: "  " }, TaskErrorCode.InvalidTitle],
    ["a title that is too long", { title: "x".repeat(61) }, TaskErrorCode.InvalidTitle],
    ["zero", { every: 0 }, TaskErrorCode.InvalidInterval],
    ["a fraction", { every: 1.5 }, TaskErrorCode.InvalidInterval],
    ["more than a year of units", { every: 366 }, TaskErrorCode.InvalidInterval],
    ["an unknown unit", { unit: "year" as never }, TaskErrorCode.InvalidInterval],
    ["an impossible date", { firstDueOn: "2026-02-30" }, TaskErrorCode.InvalidDate],
    ["someone from elsewhere taking turns", { rotationMemberIds: ["mia", "stranger"] }, TaskErrorCode.InvalidRotation],
    ["someone taking two turns", { rotationMemberIds: ["mia", "mia"] }, TaskErrorCode.InvalidRotation],
  ])("rejects %s", (_label, overrides, code) => {
    expect(() => createRecurringTask({ ...weeklyTrash, ...overrides }, flatmates)).toThrow(expect.objectContaining({ code }));
  });

  it("lets everyone take turns by default, starting with the first", () => {
    const task = createRecurringTask(weeklyTrash, flatmates);

    expect(task.rotation).toEqual(flatmates);
    expect(turnOf(task, flatmates)).toBe("mia");
  });

  it("passes the turn to whoever comes after the person who did it last", () => {
    const task = createRecurringTask({ ...weeklyTrash, rotationMemberIds: ["lea", "noah", "mia"] }, flatmates);
    const doneBy = (memberId: string | null, doneOn = "2026-11-02") => ({
      ...task,
      completions: [{ ...createCompletion("x", doneOn), memberId }],
    });

    expect(turnOf(doneBy("lea"), flatmates)).toBe("noah");
    expect(turnOf(doneBy("mia"), flatmates)).toBe("lea");
    // Noah stepped in for Lea: the turn goes on from Noah, so Mia is next.
    expect(turnOf(doneBy("noah"), flatmates)).toBe("mia");
    // Done by someone outside the rotation, or who left: the rotation starts over.
    expect(turnOf(doneBy(null), flatmates)).toBe("lea");
  });

  it("drops people who left, and is nobody's turn when nobody is left", () => {
    const task = createRecurringTask({ ...weeklyTrash, rotationMemberIds: ["lea", "noah"] }, flatmates);

    expect(turnOf(task, ["mia", "noah"])).toBe("noah");
    expect(turnOf(task, ["mia"])).toBeNull();
    expect(turnOf(createRecurringTask({ ...weeklyTrash, rotationMemberIds: [] }, flatmates), flatmates)).toBeNull();
  });

  it("rejects a completion without a valid day", () => {
    expect(() => createCompletion("member-1", "yesterday")).toThrow(
      expect.objectContaining({ code: TaskErrorCode.InvalidDate }),
    );
  });
});
