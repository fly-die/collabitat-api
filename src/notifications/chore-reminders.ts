import type { FastifyBaseLogger } from "fastify";
import type { HouseholdRepository } from "../households/household-repository.js";
import { nextDueOn, turnOf, type RecurringTask } from "../tasks/recurring-task.js";
import type { TaskRepository } from "../tasks/task-repository.js";
import type { Notify } from "./notifier.js";
import type { PushMessage } from "./push-sender.js";
import type { PushSubscriptionRepository, ReminderLog } from "./push-subscription-repository.js";

// Collabitat is for flatshares in Switzerland, so "the morning" is Zurich's morning.
const REMINDER_TIME_ZONE = "Europe/Zurich";
export const FIRST_REMINDER_HOUR = 8;
// After a restart late in the day it waits for tomorrow rather than buzz someone at night.
export const LAST_REMINDER_HOUR = 21;
const MAX_TITLES_IN_REMINDER = 3;
const CHECK_EVERY_MS = 5 * 60 * 1000;

const zurichFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: REMINDER_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
});
const titleList = new Intl.ListFormat("en-GB", { type: "conjunction" });

export function zurichDayAndHour(now: Date) {
  const parts = Object.fromEntries(zurichFormat.formatToParts(now).map((part) => [part.type, part.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

export function choreReminder(titles: string[], day: string): PushMessage {
  const shown = titles.slice(0, MAX_TITLES_IN_REMINDER);
  const hidden = titles.length - shown.length;
  return {
    title: titles.length === 1 ? "Your turn today" : `${titles.length} chores are your turn today`,
    body: hidden > 0 ? `${shown.join(", ")} and ${hidden} more` : titleList.format(shown),
    tag: `chores-${day}`,
  };
}

export interface ChoreReminderDependencies {
  householdRepository: HouseholdRepository;
  taskRepository: TaskRepository;
  subscriptions: PushSubscriptionRepository;
  reminderLog: ReminderLog;
  notify: Notify;
}

// One reminder per member and day, for chores that are due or overdue and their turn.
// The day is claimed before sending, so two runs can never both send it.
export async function sendChoreReminders(dependencies: ChoreReminderDependencies, now = new Date()) {
  const { day, hour } = zurichDayAndHour(now);
  if (hour < FIRST_REMINDER_HOUR || hour > LAST_REMINDER_HOUR) {
    return;
  }
  const memberIds = new Set((await dependencies.subscriptions.listAll()).map((device) => device.memberId));
  const tasksByHouseholdId = new Map<string, RecurringTask[]>();
  for (const memberId of memberIds) {
    const household = await dependencies.householdRepository.findByMemberId(memberId);
    if (!household) {
      continue;
    }
    let tasks = tasksByHouseholdId.get(household.id);
    if (!tasks) {
      tasks = await dependencies.taskRepository.listByHousehold(household.id);
      tasksByHouseholdId.set(household.id, tasks);
    }
    const currentMemberIds = household.members.map((member) => member.id);
    const myTurns = tasks
      .filter((task) => nextDueOn(task) <= day && turnOf(task, currentMemberIds) === memberId)
      .map((task) => task.title);
    if (myTurns.length > 0 && (await dependencies.reminderLog.claim(memberId, day))) {
      await dependencies.notify([memberId], choreReminder(myTurns, day));
    }
  }
}

// Checks every few minutes; the reminder log keeps it to once a day.
export function startChoreReminders(
  dependencies: ChoreReminderDependencies,
  logger: Pick<FastifyBaseLogger, "warn">,
) {
  let isRunning = false;
  const run = async () => {
    if (isRunning) {
      return;
    }
    isRunning = true;
    try {
      await sendChoreReminders(dependencies);
    } catch (error) {
      logger.warn({ err: error }, "chore reminders could not be sent");
    } finally {
      isRunning = false;
    }
  };
  void run();
  const timer = setInterval(() => void run(), CHECK_EVERY_MS);
  timer.unref();
  return () => clearInterval(timer);
}
