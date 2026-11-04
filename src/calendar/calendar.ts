import { randomUUID } from "node:crypto";

export const CalendarErrorCode = {
  InvalidColumnName: "INVALID_COLUMN_NAME",
  InvalidTitle: "INVALID_TITLE",
  InvalidDay: "INVALID_DAY",
  InvalidTime: "INVALID_TIME",
  UnknownColumn: "UNKNOWN_COLUMN",
  ColumnHasDates: "COLUMN_HAS_DATES",
  ColumnNotFound: "COLUMN_NOT_FOUND",
  EntryNotFound: "ENTRY_NOT_FOUND",
} as const;

export type CalendarErrorCode = (typeof CalendarErrorCode)[keyof typeof CalendarErrorCode];

export class CalendarError extends Error {
  constructor(
    readonly code: CalendarErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CalendarError";
  }
}

export const MAX_COLUMN_NAME_LENGTH = 30;
export const MAX_COLUMNS = 12;
export const MAX_ENTRY_TITLE_LENGTH = 80;
export const DAYS_IN_CALENDAR = 28;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATE_LENGTH = 10;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

// A lane in the calendar: a person or a group, who doesn't need an account ("Noah", "Family").
export interface CalendarColumn {
  id: string;
  name: string;
  createdAt: string;
}

// An important date; without a column it is for everyone.
export interface CalendarEntry {
  id: string;
  title: string;
  day: string;
  // "HH:MM", or null for the whole day.
  time: string | null;
  columnId: string | null;
  createdAt: string;
}

export interface NewCalendarEntry {
  title: string;
  day: string;
  time?: string | null;
  columnId?: string | null;
}

export function validateDay(isoDate: string) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  if (!ISO_DATE_PATTERN.test(isoDate) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, ISO_DATE_LENGTH) !== isoDate) {
    throw new CalendarError(CalendarErrorCode.InvalidDay, "Pick a valid day.");
  }
  return isoDate;
}

export function addDays(isoDate: string, days: number) {
  return new Date(Date.parse(`${isoDate}T00:00:00Z`) + days * MILLISECONDS_PER_DAY).toISOString().slice(0, ISO_DATE_LENGTH);
}

export function createColumn(existing: CalendarColumn[], name: string): CalendarColumn {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > MAX_COLUMN_NAME_LENGTH) {
    throw new CalendarError(CalendarErrorCode.InvalidColumnName, `Give the column a name of up to ${MAX_COLUMN_NAME_LENGTH} characters.`);
  }
  if (existing.some((column) => column.name.toLowerCase() === trimmed.toLowerCase())) {
    throw new CalendarError(CalendarErrorCode.InvalidColumnName, `There's already a column called ${trimmed}.`);
  }
  if (existing.length >= MAX_COLUMNS) {
    throw new CalendarError(CalendarErrorCode.InvalidColumnName, `A calendar can have up to ${MAX_COLUMNS} columns.`);
  }
  return { id: randomUUID(), name: trimmed, createdAt: new Date().toISOString() };
}

// Builds a valid entry; pass the existing one when editing, so it keeps its id and creation time.
export function createEntry(columns: CalendarColumn[], input: NewCalendarEntry, existing?: CalendarEntry): CalendarEntry {
  const title = input.title.trim();
  if (!title || title.length > MAX_ENTRY_TITLE_LENGTH) {
    throw new CalendarError(CalendarErrorCode.InvalidTitle, `Say what it is, in up to ${MAX_ENTRY_TITLE_LENGTH} characters.`);
  }
  const time = input.time || null;
  if (time && !TIME_PATTERN.test(time)) {
    throw new CalendarError(CalendarErrorCode.InvalidTime, "Pick a valid time, like 14:30.");
  }
  const columnId = input.columnId ?? null;
  if (columnId && !columns.some((column) => column.id === columnId)) {
    throw new CalendarError(CalendarErrorCode.UnknownColumn, "That column doesn't exist anymore.");
  }
  return {
    id: existing?.id ?? randomUUID(),
    title,
    day: validateDay(input.day),
    time,
    columnId,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
  };
}

// Whole-day dates first, then by time, then in the order they were added.
export function sortEntries(entries: CalendarEntry[]) {
  return [...entries].sort(
    (first, second) =>
      first.day.localeCompare(second.day) ||
      (first.time ?? "").localeCompare(second.time ?? "") ||
      first.createdAt.localeCompare(second.createdAt),
  );
}
