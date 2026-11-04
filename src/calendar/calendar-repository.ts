import { and, asc, count, eq, gte, lte } from "drizzle-orm";
import type { Database } from "../db/database.js";
import { calendarColumns, calendarEntries } from "../db/schema.js";
import { sortEntries, type CalendarColumn, type CalendarEntry } from "./calendar.js";

export interface CalendarRepository {
  listColumns(householdId: string): Promise<CalendarColumn[]>;
  addColumn(householdId: string, column: CalendarColumn): Promise<void>;
  // Dates left in the column move to everyone. Returns false when the household has no such column.
  removeColumn(householdId: string, columnId: string): Promise<boolean>;
  countEntriesFrom(householdId: string, columnId: string, fromDay: string): Promise<number>;
  listEntries(householdId: string, fromDay: string, toDay: string): Promise<CalendarEntry[]>;
  findEntry(householdId: string, entryId: string): Promise<CalendarEntry | undefined>;
  saveEntry(householdId: string, entry: CalendarEntry): Promise<void>;
  removeEntry(householdId: string, entryId: string): Promise<boolean>;
}

export class InMemoryCalendarRepository implements CalendarRepository {
  private readonly columnsByHouseholdId = new Map<string, CalendarColumn[]>();
  private readonly entriesByHouseholdId = new Map<string, CalendarEntry[]>();

  async listColumns(householdId: string) {
    return [...(this.columnsByHouseholdId.get(householdId) ?? [])];
  }

  async addColumn(householdId: string, column: CalendarColumn) {
    this.columnsByHouseholdId.set(householdId, [...(await this.listColumns(householdId)), column]);
  }

  async removeColumn(householdId: string, columnId: string) {
    const columns = await this.listColumns(householdId);
    if (!columns.some((column) => column.id === columnId)) {
      return false;
    }
    this.columnsByHouseholdId.set(householdId, columns.filter((column) => column.id !== columnId));
    this.entriesByHouseholdId.set(
      householdId,
      this.entriesOf(householdId).map((entry) => (entry.columnId === columnId ? { ...entry, columnId: null } : entry)),
    );
    return true;
  }

  async countEntriesFrom(householdId: string, columnId: string, fromDay: string) {
    return this.entriesOf(householdId).filter((entry) => entry.columnId === columnId && entry.day >= fromDay).length;
  }

  async listEntries(householdId: string, fromDay: string, toDay: string) {
    return sortEntries(this.entriesOf(householdId).filter((entry) => entry.day >= fromDay && entry.day <= toDay));
  }

  async findEntry(householdId: string, entryId: string) {
    return this.entriesOf(householdId).find((entry) => entry.id === entryId);
  }

  async saveEntry(householdId: string, entry: CalendarEntry) {
    this.entriesByHouseholdId.set(householdId, [...this.entriesOf(householdId).filter((existing) => existing.id !== entry.id), entry]);
  }

  async removeEntry(householdId: string, entryId: string) {
    const entries = this.entriesOf(householdId);
    const remaining = entries.filter((entry) => entry.id !== entryId);
    this.entriesByHouseholdId.set(householdId, remaining);
    return remaining.length !== entries.length;
  }

  private entriesOf(householdId: string) {
    return this.entriesByHouseholdId.get(householdId) ?? [];
  }
}

type EntryRow = typeof calendarEntries.$inferSelect;

const toEntry = (row: EntryRow): CalendarEntry => ({
  id: row.id,
  title: row.title,
  day: row.day,
  time: row.time,
  columnId: row.columnId,
  createdAt: row.createdAt.toISOString(),
});

export class PostgresCalendarRepository implements CalendarRepository {
  constructor(private readonly database: Database) {}

  async listColumns(householdId: string) {
    const rows = await this.database
      .select()
      .from(calendarColumns)
      .where(eq(calendarColumns.householdId, householdId))
      .orderBy(asc(calendarColumns.createdAt));
    return rows.map((row) => ({ id: row.id, name: row.name, createdAt: row.createdAt.toISOString() }));
  }

  async addColumn(householdId: string, column: CalendarColumn) {
    await this.database.insert(calendarColumns).values({ ...column, householdId, createdAt: new Date(column.createdAt) });
  }

  async removeColumn(householdId: string, columnId: string) {
    const removed = await this.database
      .delete(calendarColumns)
      .where(and(eq(calendarColumns.householdId, householdId), eq(calendarColumns.id, columnId)))
      .returning({ id: calendarColumns.id });
    return removed.length > 0;
  }

  async countEntriesFrom(householdId: string, columnId: string, fromDay: string) {
    const [row] = await this.database
      .select({ entries: count() })
      .from(calendarEntries)
      .where(and(eq(calendarEntries.householdId, householdId), eq(calendarEntries.columnId, columnId), gte(calendarEntries.day, fromDay)));
    return row.entries;
  }

  async listEntries(householdId: string, fromDay: string, toDay: string) {
    const rows = await this.database
      .select()
      .from(calendarEntries)
      .where(and(eq(calendarEntries.householdId, householdId), gte(calendarEntries.day, fromDay), lte(calendarEntries.day, toDay)));
    return sortEntries(rows.map(toEntry));
  }

  async findEntry(householdId: string, entryId: string) {
    const [row] = await this.database
      .select()
      .from(calendarEntries)
      .where(and(eq(calendarEntries.householdId, householdId), eq(calendarEntries.id, entryId)));
    return row && toEntry(row);
  }

  async saveEntry(householdId: string, entry: CalendarEntry) {
    const values = { ...entry, householdId, createdAt: new Date(entry.createdAt) };
    await this.database
      .insert(calendarEntries)
      .values(values)
      .onConflictDoUpdate({ target: calendarEntries.id, set: { title: entry.title, day: entry.day, time: entry.time, columnId: entry.columnId } });
  }

  async removeEntry(householdId: string, entryId: string) {
    const removed = await this.database
      .delete(calendarEntries)
      .where(and(eq(calendarEntries.householdId, householdId), eq(calendarEntries.id, entryId)))
      .returning({ id: calendarEntries.id });
    return removed.length > 0;
  }
}
