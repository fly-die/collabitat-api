import type { FastifyInstance } from "fastify";
import { HttpStatus } from "../http-status.js";
import type { Authenticate } from "../sessions/authenticate.js";
import { MAX_NOTE_LENGTH, NoteError, NoteErrorCode, createNote } from "./note.js";
import type { NoteRepository } from "./note-repository.js";

const idParams = { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } } as const;
const newNoteBody = {
  type: "object",
  required: ["text"],
  additionalProperties: false,
  // done lets undo put back a note that was cleared while ticked.
  properties: { text: { type: "string", maxLength: MAX_NOTE_LENGTH * 2 }, done: { type: "boolean" } },
} as const;
const doneBody = { type: "object", required: ["done"], additionalProperties: false, properties: { done: { type: "boolean" } } } as const;

interface NoteRouteDependencies {
  authenticate: Authenticate;
  noteRepository: NoteRepository;
}

export function noteRoutes({ authenticate, noteRepository }: NoteRouteDependencies) {
  return async function registerNoteRoutes(app: FastifyInstance) {
    app.get("/household/notes", async (request) => {
      const { household } = await authenticate(request);
      return { notes: await noteRepository.list(household.id) };
    });

    app.post<{ Body: { text: string; done?: boolean } }>("/household/notes", { schema: { body: newNoteBody } }, async (request, reply) => {
      const { household, currentMemberId } = await authenticate(request);
      const note = createNote(request.body.text, currentMemberId, request.body.done);
      await noteRepository.add(household.id, note);
      return reply.status(HttpStatus.Created).send({ note });
    });

    app.put<{ Params: { id: string }; Body: { done: boolean } }>(
      "/household/notes/:id/done",
      { schema: { params: idParams, body: doneBody } },
      async (request) => {
        const { household } = await authenticate(request);
        const note = await noteRepository.setDoneAt(household.id, request.params.id, request.body.done ? new Date().toISOString() : null);
        if (!note) {
          throw new NoteError(NoteErrorCode.NoteNotFound, "That note was removed in the meantime.");
        }
        return { note };
      },
    );

    app.delete<{ Params: { id: string } }>("/household/notes/:id", { schema: { params: idParams } }, async (request, reply) => {
      const { household } = await authenticate(request);
      if (!(await noteRepository.remove(household.id, request.params.id))) {
        throw new NoteError(NoteErrorCode.NoteNotFound, "That note was removed in the meantime.");
      }
      return reply.status(HttpStatus.NoContent).send();
    });

    app.delete("/household/notes/done", async (request) => {
      const { household } = await authenticate(request);
      return { removed: await noteRepository.removeDone(household.id) };
    });
  };
}
