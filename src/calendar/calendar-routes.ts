import type { FastifyInstance } from "fastify";
import { HttpStatus } from "../http-status.js";
import type { Authenticate } from "../sessions/authenticate.js";
import {
  CalendarError,
  CalendarErrorCode,
  DAYS_IN_CALENDAR,
  MAX_COLUMN_NAME_LENGTH,
  MAX_ENTRY_TITLE_LENGTH,
  addDays,
  createColumn,
  createEntry,
  validateDay,
  type NewCalendarEntry,
} from "./calendar.js";
import type { CalendarRepository } from "./calendar-repository.js";

const ISO_DATE_LENGTH = 10;
const TIME_LENGTH = 5;
const fromQuery = { type: "object", required: ["from"], properties: { from: { type: "string", maxLength: ISO_DATE_LENGTH } } } as const;
const idParams = { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } } as const;
const columnBody = {
  type: "object",
  required: ["name"],
  additionalProperties: false,
  properties: { name: { type: "string", maxLength: MAX_COLUMN_NAME_LENGTH * 2 } },
} as const;
const entryBody = {
  type: "object",
  required: ["title", "day"],
  additionalProperties: false,
  properties: {
    title: { type: "string", maxLength: MAX_ENTRY_TITLE_LENGTH * 2 },
    day: { type: "string", maxLength: ISO_DATE_LENGTH },
    time: { type: ["string", "null"], maxLength: TIME_LENGTH },
    columnId: { type: ["string", "null"], format: "uuid" },
  },
} as const;

const today = () => new Date().toISOString().slice(0, ISO_DATE_LENGTH);
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

interface CalendarRouteDependencies {
  authenticate: Authenticate;
  calendarRepository: CalendarRepository;
}

export function calendarRoutes({ authenticate, calendarRepository }: CalendarRouteDependencies) {
  return async function registerCalendarRoutes(app: FastifyInstance) {
    // Four weeks from a day: the columns and every date in that time.
    app.get<{ Querystring: { from: string } }>("/household/calendar", { schema: { querystring: fromQuery } }, async (request) => {
      const { household } = await authenticate(request);
      const from = validateDay(request.query.from);
      const to = addDays(from, DAYS_IN_CALENDAR - 1);
      const [columns, entries] = await Promise.all([
        calendarRepository.listColumns(household.id),
        calendarRepository.listEntries(household.id, from, to),
      ]);
      return { from, to, columns, entries };
    });

    app.post<{ Body: { name: string } }>("/household/calendar/columns", { schema: { body: columnBody } }, async (request, reply) => {
      const { household } = await authenticate(request);
      const column = createColumn(await calendarRepository.listColumns(household.id), request.body.name);
      await calendarRepository.addColumn(household.id, column);
      return reply.status(HttpStatus.Created).send({ column });
    });

    app.delete<{ Params: { id: string } }>("/household/calendar/columns/:id", { schema: { params: idParams } }, async (request, reply) => {
      const { household } = await authenticate(request);
      const column = (await calendarRepository.listColumns(household.id)).find((candidate) => candidate.id === request.params.id);
      if (!column) {
        throw new CalendarError(CalendarErrorCode.ColumnNotFound, "That column doesn't exist anymore.");
      }
      const upcoming = await calendarRepository.countEntriesFrom(household.id, column.id, today());
      if (upcoming > 0) {
        throw new CalendarError(
          CalendarErrorCode.ColumnHasDates,
          `${column.name} still has ${plural(upcoming, "upcoming date")}. Move or remove them first.`,
        );
      }
      await calendarRepository.removeColumn(household.id, column.id);
      return reply.status(HttpStatus.NoContent).send();
    });

    app.post<{ Body: NewCalendarEntry }>("/household/calendar/entries", { schema: { body: entryBody } }, async (request, reply) => {
      const { household } = await authenticate(request);
      const entry = createEntry(await calendarRepository.listColumns(household.id), request.body);
      await calendarRepository.saveEntry(household.id, entry);
      return reply.status(HttpStatus.Created).send({ entry });
    });

    app.put<{ Params: { id: string }; Body: NewCalendarEntry }>(
      "/household/calendar/entries/:id",
      { schema: { params: idParams, body: entryBody } },
      async (request) => {
        const { household } = await authenticate(request);
        const existing = await calendarRepository.findEntry(household.id, request.params.id);
        if (!existing) {
          throw new CalendarError(CalendarErrorCode.EntryNotFound, "That date was removed in the meantime.");
        }
        const entry = createEntry(await calendarRepository.listColumns(household.id), request.body, existing);
        await calendarRepository.saveEntry(household.id, entry);
        return { entry };
      },
    );

    app.delete<{ Params: { id: string } }>("/household/calendar/entries/:id", { schema: { params: idParams } }, async (request, reply) => {
      const { household } = await authenticate(request);
      if (!(await calendarRepository.removeEntry(household.id, request.params.id))) {
        throw new CalendarError(CalendarErrorCode.EntryNotFound, "That date was removed in the meantime.");
      }
      return reply.status(HttpStatus.NoContent).send();
    });
  };
}
