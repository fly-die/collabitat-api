import { and, desc, eq, inArray, type SQL } from "drizzle-orm";
import type { Database } from "../db/database.js";
import { recurringTasks, taskCompletions } from "../db/schema.js";
import type { IntervalUnit, RecurringTask, TaskCompletion } from "./recurring-task.js";
import type { TaskRepository } from "./task-repository.js";

export class PostgresTaskRepository implements TaskRepository {
  constructor(private readonly database: Database) {}

  private async load(where: SQL | undefined): Promise<RecurringTask[]> {
    const tasks = await this.database.select().from(recurringTasks).where(where).orderBy(recurringTasks.createdAt);
    if (tasks.length === 0) {
      return [];
    }
    const completions = await this.database
      .select()
      .from(taskCompletions)
      .where(
        inArray(
          taskCompletions.taskId,
          tasks.map((task) => task.id),
        ),
      )
      .orderBy(desc(taskCompletions.doneOn), desc(taskCompletions.createdAt));
    return tasks.map((task) => ({
      id: task.id,
      title: task.title,
      interval: { every: task.intervalCount, unit: task.intervalUnit as IntervalUnit },
      firstDueOn: task.firstDueOn,
      createdAt: task.createdAt.toISOString(),
      completions: completions
        .filter((completion) => completion.taskId === task.id)
        .map(({ id, doneOn, memberId, createdAt }) => ({ id, doneOn, memberId, createdAt: createdAt.toISOString() })),
    }));
  }

  listByHousehold(householdId: string) {
    return this.load(eq(recurringTasks.householdId, householdId));
  }

  async find(householdId: string, taskId: string) {
    const [task] = await this.load(and(eq(recurringTasks.id, taskId), eq(recurringTasks.householdId, householdId)));
    return task;
  }

  async add(householdId: string, task: RecurringTask) {
    await this.database.insert(recurringTasks).values({
      id: task.id,
      householdId,
      title: task.title,
      intervalCount: task.interval.every,
      intervalUnit: task.interval.unit,
      firstDueOn: task.firstDueOn,
      createdAt: new Date(task.createdAt),
    });
  }

  async remove(householdId: string, taskId: string) {
    const removed = await this.database
      .delete(recurringTasks)
      .where(and(eq(recurringTasks.id, taskId), eq(recurringTasks.householdId, householdId)))
      .returning({ id: recurringTasks.id });
    return removed.length > 0;
  }

  async addCompletion(taskId: string, completion: TaskCompletion) {
    await this.database
      .insert(taskCompletions)
      .values({ ...completion, taskId, createdAt: new Date(completion.createdAt) });
  }

  async removeCompletion(taskId: string, completionId: string) {
    const removed = await this.database
      .delete(taskCompletions)
      .where(and(eq(taskCompletions.id, completionId), eq(taskCompletions.taskId, taskId)))
      .returning({ id: taskCompletions.id });
    return removed.length > 0;
  }
}
