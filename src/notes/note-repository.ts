import { and, eq, isNotNull } from "drizzle-orm";
import type { Database } from "../db/database.js";
import { notes } from "../db/schema.js";
import { sortNotes, type Note } from "./note.js";

export interface NoteRepository {
  list(householdId: string): Promise<Note[]>;
  add(householdId: string, note: Note): Promise<void>;
  // Returns the changed note, or undefined when the household has no such note.
  setDoneAt(householdId: string, noteId: string, doneAt: string | null): Promise<Note | undefined>;
  remove(householdId: string, noteId: string): Promise<boolean>;
  // Returns what was removed, so it can be put back.
  removeDone(householdId: string): Promise<Note[]>;
}

export class InMemoryNoteRepository implements NoteRepository {
  private readonly notesByHouseholdId = new Map<string, Note[]>();

  async list(householdId: string) {
    return sortNotes(this.notesOf(householdId));
  }

  async add(householdId: string, note: Note) {
    this.notesByHouseholdId.set(householdId, [...this.notesOf(householdId), note]);
  }

  async setDoneAt(householdId: string, noteId: string, doneAt: string | null) {
    const note = this.notesOf(householdId).find((candidate) => candidate.id === noteId);
    if (!note) {
      return undefined;
    }
    const changed = { ...note, doneAt };
    this.notesByHouseholdId.set(householdId, this.notesOf(householdId).map((candidate) => (candidate.id === noteId ? changed : candidate)));
    return changed;
  }

  async remove(householdId: string, noteId: string) {
    const all = this.notesOf(householdId);
    const remaining = all.filter((note) => note.id !== noteId);
    this.notesByHouseholdId.set(householdId, remaining);
    return remaining.length !== all.length;
  }

  async removeDone(householdId: string) {
    const all = this.notesOf(householdId);
    this.notesByHouseholdId.set(householdId, all.filter((note) => !note.doneAt));
    return sortNotes(all.filter((note) => note.doneAt));
  }

  private notesOf(householdId: string) {
    return this.notesByHouseholdId.get(householdId) ?? [];
  }
}

type NoteRow = typeof notes.$inferSelect;

const toNote = (row: NoteRow): Note => ({
  id: row.id,
  text: row.text,
  authorMemberId: row.authorMemberId,
  doneAt: row.doneAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
});

export class PostgresNoteRepository implements NoteRepository {
  constructor(private readonly database: Database) {}

  async list(householdId: string) {
    const rows = await this.database.select().from(notes).where(eq(notes.householdId, householdId));
    return sortNotes(rows.map(toNote));
  }

  async add(householdId: string, note: Note) {
    await this.database.insert(notes).values({
      ...note,
      householdId,
      doneAt: note.doneAt ? new Date(note.doneAt) : null,
      createdAt: new Date(note.createdAt),
    });
  }

  async setDoneAt(householdId: string, noteId: string, doneAt: string | null) {
    const [row] = await this.database
      .update(notes)
      .set({ doneAt: doneAt ? new Date(doneAt) : null })
      .where(and(eq(notes.householdId, householdId), eq(notes.id, noteId)))
      .returning();
    return row && toNote(row);
  }

  async remove(householdId: string, noteId: string) {
    const removed = await this.database
      .delete(notes)
      .where(and(eq(notes.householdId, householdId), eq(notes.id, noteId)))
      .returning({ id: notes.id });
    return removed.length > 0;
  }

  async removeDone(householdId: string) {
    const removed = await this.database
      .delete(notes)
      .where(and(eq(notes.householdId, householdId), isNotNull(notes.doneAt)))
      .returning();
    return sortNotes(removed.map(toNote));
  }
}
