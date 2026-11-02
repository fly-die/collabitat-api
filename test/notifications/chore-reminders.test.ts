import { describe, expect, it, vi } from "vitest";
import { addMember, createHousehold } from "../../src/households/household.js";
import { InMemoryHouseholdRepository } from "../../src/households/household-repository.js";
import { choreReminder, sendChoreReminders, startChoreReminders, zurichDayAndHour } from "../../src/notifications/chore-reminders.js";
import type { PushMessage } from "../../src/notifications/push-sender.js";
import {
  InMemoryPushSubscriptionRepository,
  InMemoryReminderLog,
} from "../../src/notifications/push-subscription-repository.js";
import { createRecurringTask } from "../../src/tasks/recurring-task.js";
import { InMemoryTaskRepository } from "../../src/tasks/task-repository.js";

// 08:30 in Zurich on Monday 2 November 2026 (winter time, UTC+1).
const MONDAY_MORNING = new Date("2026-11-02T07:30:00Z");

async function flatWithChores(titlesDueForMia: string[]) {
  const households = new InMemoryHouseholdRepository();
  const tasks = new InMemoryTaskRepository();
  const subscriptions = new InMemoryPushSubscriptionRepository();
  const household = addMember(createHousehold("Langstrasse 12", "Mia").household, "Lea");
  const [mia, lea] = household.members;
  await households.save(household);
  for (const title of titlesDueForMia) {
    await tasks.add(household.id, createRecurringTask({ title, every: 1, unit: "week", firstDueOn: "2026-11-01" }, [mia.id, lea.id]));
  }
  await tasks.add(household.id, createRecurringTask({ title: "Water the plants", every: 1, unit: "week", firstDueOn: "2026-11-03" }, [mia.id]));
  for (const [memberId, endpoint] of [[mia.id, "mia-phone"], [mia.id, "mia-laptop"], [lea.id, "lea-phone"]]) {
    await subscriptions.save(memberId, { endpoint, keys: { p256dh: "p", auth: "a" } });
  }
  const sent: { memberIds: string[]; message: PushMessage }[] = [];
  const dependencies = {
    householdRepository: households,
    taskRepository: tasks,
    subscriptions,
    reminderLog: new InMemoryReminderLog(),
    notify: async (memberIds: string[], message: PushMessage) => {
      sent.push({ memberIds, message });
    },
  };
  return { dependencies, sent, mia };
}

describe("chore reminders", () => {
  it("reads the day and hour in Zurich", () => {
    expect(zurichDayAndHour(new Date("2026-11-01T23:30:00Z"))).toEqual({ day: "2026-11-02", hour: 0 });
    expect(zurichDayAndHour(new Date("2026-07-01T06:00:00Z"))).toEqual({ day: "2026-07-01", hour: 8 });
  });

  it("reminds each member once a day about the chores due that are their turn", async () => {
    const { dependencies, sent, mia } = await flatWithChores(["Take out the trash"]);

    await sendChoreReminders(dependencies, MONDAY_MORNING);
    await sendChoreReminders(dependencies, new Date("2026-11-02T15:00:00Z"));

    expect(sent).toEqual([
      { memberIds: [mia.id], message: { title: "Your turn today", body: "Take out the trash", tag: "chores-2026-11-02" } },
    ]);
  });

  it("waits for the morning and stays quiet at night", async () => {
    const { dependencies, sent } = await flatWithChores(["Take out the trash"]);

    await sendChoreReminders(dependencies, new Date("2026-11-02T06:59:00Z"));
    await sendChoreReminders(dependencies, new Date("2026-11-02T21:00:00Z"));

    expect(sent).toEqual([]);
  });

  it.each([
    [["Trash", "Bathroom"], "2 chores are your turn today", "Trash and Bathroom"],
    [["Trash", "Bathroom", "Hallway"], "3 chores are your turn today", "Trash, Bathroom and Hallway"],
    [["Trash", "Bathroom", "Hallway", "Kettle"], "4 chores are your turn today", "Trash, Bathroom, Hallway and 1 more"],
  ])("sums up several chores: %j", (titles, title, body) => {
    expect(choreReminder(titles, "2026-11-02")).toEqual({ title, body, tag: "chores-2026-11-02" });
  });
});

describe("chore reminder schedule", () => {
  it("checks right away, keeps checking, and logs instead of crashing when a check fails", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(MONDAY_MORNING);
    const { dependencies, sent } = await flatWithChores(["Take out the trash"]);
    const brokenSubscriptions = Object.assign(new InMemoryPushSubscriptionRepository(), {
      listAll: vi.fn().mockRejectedValue(new Error("db down")),
    });
    const failing = { ...dependencies, subscriptions: brokenSubscriptions };
    const logger = { warn: vi.fn() };

    const stop = startChoreReminders(dependencies, logger);
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    stop();

    const stopFailing = startChoreReminders(failing, logger);
    await vi.waitFor(() => expect(logger.warn).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(failing.subscriptions.listAll).toHaveBeenCalledTimes(2);
    stopFailing();
    vi.useRealTimers();
  });
});
