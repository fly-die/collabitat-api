import { randomUUID } from "node:crypto";

export const NoteErrorCode = {
  InvalidText: "INVALID_TEXT",
  NoteNotFound: "NOTE_NOT_FOUND",
} as const;

export type NoteErrorCode = (typeof NoteErrorCode)[keyof typeof NoteErrorCode];

export class NoteError extends Error {
  constructor(
    readonly code: NoteErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "NoteError";
  }
}

export const MAX_NOTE_LENGTH = 280;

// A quick note for the whole household; ticking it off makes it a done todo.
export interface Note {
  id: string;
  text: string;
  // Null once the author left the household.
  authorMemberId: string | null;
  doneAt: string | null;
  createdAt: string;
}

export function createNote(text: string, authorMemberId: string, isDone = false): Note {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > MAX_NOTE_LENGTH) {
    throw new NoteError(NoteErrorCode.InvalidText, `Write a note of up to ${MAX_NOTE_LENGTH} characters.`);
  }
  const now = new Date().toISOString();
  return { id: randomUUID(), text: trimmed, authorMemberId, doneAt: isDone ? now : null, createdAt: now };
}

// Open notes first, newest on top; then done ones, most recently ticked first.
export function sortNotes(notes: Note[]) {
  const open = notes.filter((note) => !note.doneAt).sort((first, second) => second.createdAt.localeCompare(first.createdAt));
  const done = notes
    .filter((note) => note.doneAt)
    .sort((first, second) => (second.doneAt as string).localeCompare(first.doneAt as string));
  return [...open, ...done];
}
