export const TaskErrorCode = {
  InvalidTitle: "INVALID_TITLE",
  InvalidInterval: "INVALID_INTERVAL",
  InvalidDate: "INVALID_DATE",
  TaskNotFound: "TASK_NOT_FOUND",
  CompletionNotFound: "COMPLETION_NOT_FOUND",
} as const;

export type TaskErrorCode = (typeof TaskErrorCode)[keyof typeof TaskErrorCode];

export class TaskError extends Error {
  constructor(
    readonly code: TaskErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "TaskError";
  }
}
