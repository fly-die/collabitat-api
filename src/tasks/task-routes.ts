import type { FastifyInstance } from "fastify";
import { HttpStatus } from "../http-status.js";
import type { Authenticate } from "../sessions/authenticate.js";
import {
  INTERVAL_UNITS,
  MAX_TITLE_LENGTH,
  createCompletion,
  createRecurringTask,
  latestCompletion,
  nextDueOn,
  type NewRecurringTask,
  type RecurringTask,
} from "./recurring-task.js";
import { TaskError, TaskErrorCode } from "./task-errors.js";
import type { TaskRepository } from "./task-repository.js";

const ISO_DATE_LENGTH = 10;

const uuidProperty = { type: "string", format: "uuid" } as const;

const newTaskBodySchema = {
  type: "object",
  required: ["title", "every", "unit", "firstDueOn"],
  additionalProperties: false,
  properties: {
    title: { type: "string", maxLength: MAX_TITLE_LENGTH * 2 },
    every: { type: "number" },
    unit: { type: "string", enum: INTERVAL_UNITS },
    firstDueOn: { type: "string", maxLength: ISO_DATE_LENGTH },
  },
} as const;

const completionBodySchema = {
  type: "object",
  required: ["doneOn"],
  additionalProperties: false,
  properties: { doneOn: { type: "string", maxLength: ISO_DATE_LENGTH } },
} as const;

const taskParamsSchema = {
  type: "object",
  required: ["taskId"],
  properties: { taskId: uuidProperty },
} as const;

const completionParamsSchema = {
  type: "object",
  required: ["taskId", "completionId"],
  properties: { taskId: uuidProperty, completionId: uuidProperty },
} as const;

interface TaskParams {
  taskId: string;
}

interface CompletionParams extends TaskParams {
  completionId: string;
}

interface TaskRouteDependencies {
  authenticate: Authenticate;
  taskRepository: TaskRepository;
}

function toTaskView(task: RecurringTask) {
  const latest = latestCompletion(task);
  return {
    id: task.id,
    title: task.title,
    every: task.interval.every,
    unit: task.interval.unit,
    firstDueOn: task.firstDueOn,
    nextDueOn: nextDueOn(task),
    lastCompletion: latest ? { id: latest.id, doneOn: latest.doneOn, memberId: latest.memberId } : null,
  };
}

export function taskRoutes({ authenticate, taskRepository }: TaskRouteDependencies) {
  // Soonest first; the same day is ordered by title so the list doesn't jump around.
  async function tasksView(householdId: string) {
    const tasks = (await taskRepository.listByHousehold(householdId)).map(toTaskView);
    tasks.sort((first, second) => first.nextDueOn.localeCompare(second.nextDueOn) || first.title.localeCompare(second.title));
    return { tasks };
  }

  async function findTask(householdId: string, taskId: string) {
    const task = await taskRepository.find(householdId, taskId);
    if (!task) {
      throw new TaskError(TaskErrorCode.TaskNotFound, "That chore is already gone.");
    }
    return task;
  }

  return async function register(app: FastifyInstance) {
    app.get("/household/tasks", async (request) => {
      const { household } = await authenticate(request);
      return tasksView(household.id);
    });

    app.post<{ Body: NewRecurringTask }>(
      "/household/tasks",
      { schema: { body: newTaskBodySchema } },
      async (request, reply) => {
        const { household } = await authenticate(request);
        await taskRepository.add(household.id, createRecurringTask(request.body));
        return reply.status(HttpStatus.Created).send(await tasksView(household.id));
      },
    );

    app.delete<{ Params: TaskParams }>(
      "/household/tasks/:taskId",
      { schema: { params: taskParamsSchema } },
      async (request) => {
        const { household } = await authenticate(request);
        if (!(await taskRepository.remove(household.id, request.params.taskId))) {
          throw new TaskError(TaskErrorCode.TaskNotFound, "That chore is already gone.");
        }
        return tasksView(household.id);
      },
    );

    app.post<{ Params: TaskParams; Body: { doneOn: string } }>(
      "/household/tasks/:taskId/completions",
      { schema: { params: taskParamsSchema, body: completionBodySchema } },
      async (request, reply) => {
        const { household, currentMemberId } = await authenticate(request);
        const task = await findTask(household.id, request.params.taskId);
        await taskRepository.addCompletion(task.id, createCompletion(currentMemberId, request.body.doneOn));
        return reply.status(HttpStatus.Created).send(await tasksView(household.id));
      },
    );

    app.delete<{ Params: CompletionParams }>(
      "/household/tasks/:taskId/completions/:completionId",
      { schema: { params: completionParamsSchema } },
      async (request) => {
        const { household } = await authenticate(request);
        const task = await findTask(household.id, request.params.taskId);
        if (!(await taskRepository.removeCompletion(task.id, request.params.completionId))) {
          throw new TaskError(TaskErrorCode.CompletionNotFound, "That was already undone.");
        }
        return tasksView(household.id);
      },
    );
  };
}
