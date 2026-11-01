import { randomUUID } from "node:crypto";
import { TaskError, TaskErrorCode } from "./task-errors.js";

export const MAX_TITLE_LENGTH = 60;
export const MAX_INTERVAL_COUNT = 365;
export const INTERVAL_UNITS = ["day", "week", "month"] as const;
const DAYS_PER_WEEK = 7;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATE_LENGTH = 10;

export type IntervalUnit = (typeof INTERVAL_UNITS)[number];

export interface Interval {
  every: number;
  unit: IntervalUnit;
}

export interface TaskCompletion {
  id: string;
  doneOn: string;
  // Null once the member who did it has left the household.
  memberId: string | null;
  createdAt: string;
}

// The generic engine behind chores (and later the Servicebook): the next due date
// is never stored, it always follows from the latest completion.
export interface RecurringTask {
  id: string;
  title: string;
  interval: Interval;
  firstDueOn: string;
  createdAt: string;
  // Who takes turns, in order. Empty when nobody in particular does it.
  rotation: string[];
  // Latest first: latest day first, and on the same day the one recorded last.
  completions: TaskCompletion[];
}

export interface NewRecurringTask {
  title: string;
  every: number;
  unit: IntervalUnit;
  firstDueOn: string;
  // Everyone allowed takes turns when this is left out.
  rotationMemberIds?: string[];
}

function validateDate(isoDate: string) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  if (
    !ISO_DATE_PATTERN.test(isoDate) ||
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, ISO_DATE_LENGTH) !== isoDate
  ) {
    throw new TaskError(TaskErrorCode.InvalidDate, "Pick a valid date.");
  }
}

function normalizeTitle(rawTitle: string) {
  const title = rawTitle.trim().replace(/\s+/g, " ");
  if (title.length === 0 || title.length > MAX_TITLE_LENGTH) {
    throw new TaskError(TaskErrorCode.InvalidTitle, `Say what needs doing in 1 to ${MAX_TITLE_LENGTH} characters.`);
  }
  return title;
}

function validateInterval({ every, unit }: Interval) {
  if (!Number.isInteger(every) || every < 1 || every > MAX_INTERVAL_COUNT || !INTERVAL_UNITS.includes(unit)) {
    throw new TaskError(
      TaskErrorCode.InvalidInterval,
      `Repeat every 1 to ${MAX_INTERVAL_COUNT} days, weeks or months.`,
    );
  }
}

function validateRotation(rotation: string[], allowedMemberIds: string[]) {
  if (new Set(rotation).size !== rotation.length || rotation.some((memberId) => !allowedMemberIds.includes(memberId))) {
    throw new TaskError(TaskErrorCode.InvalidRotation, "Pick who takes turns from the people in this household.");
  }
}

export function createRecurringTask(newTask: NewRecurringTask, allowedMemberIds: string[]): RecurringTask {
  const interval = { every: newTask.every, unit: newTask.unit };
  const rotation = newTask.rotationMemberIds ?? allowedMemberIds;
  validateInterval(interval);
  validateDate(newTask.firstDueOn);
  validateRotation(rotation, allowedMemberIds);
  return {
    id: randomUUID(),
    title: normalizeTitle(newTask.title),
    interval,
    firstDueOn: newTask.firstDueOn,
    createdAt: new Date().toISOString(),
    rotation,
    completions: [],
  };
}

export function createCompletion(memberId: string, doneOn: string): TaskCompletion {
  validateDate(doneOn);
  return { id: randomUUID(), doneOn, memberId, createdAt: new Date().toISOString() };
}

// Months keep the day of the month where it exists, otherwise the month's last day:
// 31 January plus one month is 28 (or 29) February.
export function addInterval(isoDate: string, { every, unit }: Interval) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  if (unit === "month") {
    const dayOfMonth = date.getUTCDate();
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() + every);
    const lastDayOfMonth = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
    date.setUTCDate(Math.min(dayOfMonth, lastDayOfMonth));
  } else {
    date.setUTCDate(date.getUTCDate() + (unit === "week" ? every * DAYS_PER_WEEK : every));
  }
  return date.toISOString().slice(0, ISO_DATE_LENGTH);
}

export function latestCompletion(task: RecurringTask): TaskCompletion | undefined {
  return [...task.completions].sort(
    (first, second) => second.doneOn.localeCompare(first.doneOn) || second.createdAt.localeCompare(first.createdAt),
  )[0];
}

// Counted from when it was actually done, so doing a chore late doesn't make the next one due early.
export function nextDueOn(task: RecurringTask) {
  const latest = latestCompletion(task);
  return latest ? addInterval(latest.doneOn, task.interval) : task.firstDueOn;
}

// Whoever did it last, the next person in the rotation is up, so swapping a turn stays fair.
// People who left (not in currentMemberIds) drop out; with nobody left it's nobody's turn.
export function turnOf(task: RecurringTask, currentMemberIds: string[]): string | null {
  const rotation = task.rotation.filter((memberId) => currentMemberIds.includes(memberId));
  if (rotation.length === 0) {
    return null;
  }
  const lastDoneBy = latestCompletion(task)?.memberId;
  const lastIndex = lastDoneBy ? rotation.indexOf(lastDoneBy) : -1;
  return lastIndex === -1 ? rotation[0] : rotation[(lastIndex + 1) % rotation.length];
}
