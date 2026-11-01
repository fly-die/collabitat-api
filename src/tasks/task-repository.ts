import type { RecurringTask, TaskCompletion } from "./recurring-task.js";

export interface TaskRepository {
  listByHousehold(householdId: string): Promise<RecurringTask[]>;
  find(householdId: string, taskId: string): Promise<RecurringTask | undefined>;
  add(householdId: string, task: RecurringTask): Promise<void>;
  // Returns false when the household has no task with this id.
  remove(householdId: string, taskId: string): Promise<boolean>;
  // Callers check first that the task belongs to the household.
  addCompletion(taskId: string, completion: TaskCompletion): Promise<void>;
  // Returns false when the task has no completion with this id.
  removeCompletion(taskId: string, completionId: string): Promise<boolean>;
}

export class InMemoryTaskRepository implements TaskRepository {
  private readonly tasksByHouseholdId = new Map<string, RecurringTask[]>();

  private allTasks() {
    return [...this.tasksByHouseholdId.values()].flat();
  }

  private replaceTask(taskId: string, change: (task: RecurringTask) => RecurringTask) {
    for (const [householdId, tasks] of this.tasksByHouseholdId) {
      this.tasksByHouseholdId.set(
        householdId,
        tasks.map((task) => (task.id === taskId ? change(task) : task)),
      );
    }
  }

  async listByHousehold(householdId: string) {
    return [...(this.tasksByHouseholdId.get(householdId) ?? [])];
  }

  async find(householdId: string, taskId: string) {
    return this.tasksByHouseholdId.get(householdId)?.find((task) => task.id === taskId);
  }

  async add(householdId: string, task: RecurringTask) {
    this.tasksByHouseholdId.set(householdId, [...(this.tasksByHouseholdId.get(householdId) ?? []), task]);
  }

  async remove(householdId: string, taskId: string) {
    const tasks = this.tasksByHouseholdId.get(householdId) ?? [];
    const remaining = tasks.filter((task) => task.id !== taskId);
    this.tasksByHouseholdId.set(householdId, remaining);
    return remaining.length !== tasks.length;
  }

  async addCompletion(taskId: string, completion: TaskCompletion) {
    this.replaceTask(taskId, (task) => ({ ...task, completions: [completion, ...task.completions] }));
  }

  async removeCompletion(taskId: string, completionId: string) {
    const task = this.allTasks().find((candidate) => candidate.id === taskId);
    if (!task?.completions.some((completion) => completion.id === completionId)) {
      return false;
    }
    this.replaceTask(taskId, (current) => ({
      ...current,
      completions: current.completions.filter((completion) => completion.id !== completionId),
    }));
    return true;
  }
}
