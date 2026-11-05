import type { FastifyInstance } from "fastify";
import { AccountError, AccountErrorCode } from "./accounts/account-errors.js";
import { CalendarError, CalendarErrorCode } from "./calendar/calendar.js";
import { NoteError, NoteErrorCode } from "./notes/note.js";
import { ExpenseError, ExpenseErrorCode } from "./expenses/expense-errors.js";
import { HouseholdError, HouseholdErrorCode } from "./households/household-errors.js";
import { HttpStatus } from "./http-status.js";
import { MealError, MealErrorCode } from "./meals/meal-plan.js";
import { NotificationError, NotificationErrorCode } from "./notifications/push-subscription.js";
import { TaskError, TaskErrorCode } from "./tasks/task-errors.js";

const STATUS_BY_HOUSEHOLD_ERROR: Record<HouseholdErrorCode, number> = {
  [HouseholdErrorCode.InvalidName]: HttpStatus.BadRequest,
  [HouseholdErrorCode.DuplicateMember]: HttpStatus.Conflict,
  [HouseholdErrorCode.MemberLimitReached]: HttpStatus.Conflict,
  [HouseholdErrorCode.MemberNotFound]: HttpStatus.NotFound,
  [HouseholdErrorCode.MemberAlreadyJoined]: HttpStatus.Conflict,
  [HouseholdErrorCode.MemberHasExpenses]: HttpStatus.Conflict,
  [HouseholdErrorCode.CannotRemoveYourself]: HttpStatus.Conflict,
  [HouseholdErrorCode.InviteNotFound]: HttpStatus.NotFound,
  [HouseholdErrorCode.Unauthorized]: HttpStatus.Unauthorized,
};

const STATUS_BY_ACCOUNT_ERROR: Record<AccountErrorCode, number> = {
  [AccountErrorCode.InvalidEmail]: HttpStatus.BadRequest,
  [AccountErrorCode.InvalidPassword]: HttpStatus.BadRequest,
  [AccountErrorCode.EmailTaken]: HttpStatus.Conflict,
  [AccountErrorCode.WrongCredentials]: HttpStatus.Unauthorized,
  [AccountErrorCode.NoHousehold]: HttpStatus.NotFound,
  [AccountErrorCode.AccountExists]: HttpStatus.Conflict,
};

const STATUS_BY_EXPENSE_ERROR: Record<ExpenseErrorCode, number> = {
  [ExpenseErrorCode.InvalidDescription]: HttpStatus.BadRequest,
  [ExpenseErrorCode.InvalidAmount]: HttpStatus.BadRequest,
  [ExpenseErrorCode.InvalidDate]: HttpStatus.BadRequest,
  [ExpenseErrorCode.UnknownPayer]: HttpStatus.BadRequest,
  [ExpenseErrorCode.InvalidSplit]: HttpStatus.BadRequest,
  [ExpenseErrorCode.ExpenseNotFound]: HttpStatus.NotFound,
  [ExpenseErrorCode.InvalidSettlement]: HttpStatus.BadRequest,
  [ExpenseErrorCode.SettlementNotFound]: HttpStatus.NotFound,
};

const STATUS_BY_MEAL_ERROR: Record<MealErrorCode, number> = {
  [MealErrorCode.InvalidTitle]: HttpStatus.BadRequest,
  [MealErrorCode.InvalidServings]: HttpStatus.BadRequest,
  [MealErrorCode.InvalidIngredients]: HttpStatus.BadRequest,
  [MealErrorCode.InvalidDate]: HttpStatus.BadRequest,
  [MealErrorCode.UnknownRecipe]: HttpStatus.BadRequest,
  [MealErrorCode.UnknownCook]: HttpStatus.BadRequest,
  [MealErrorCode.RecipeNotFound]: HttpStatus.NotFound,
  [MealErrorCode.InvalidMealTimes]: HttpStatus.BadRequest,
};

const STATUS_BY_NOTIFICATION_ERROR: Record<NotificationErrorCode, number> = {
  [NotificationErrorCode.InvalidSubscription]: HttpStatus.BadRequest,
  [NotificationErrorCode.PushDisabled]: HttpStatus.NotFound,
};

const STATUS_BY_TASK_ERROR: Record<TaskErrorCode, number> = {
  [TaskErrorCode.InvalidTitle]: HttpStatus.BadRequest,
  [TaskErrorCode.InvalidInterval]: HttpStatus.BadRequest,
  [TaskErrorCode.InvalidDate]: HttpStatus.BadRequest,
  [TaskErrorCode.InvalidRotation]: HttpStatus.BadRequest,
  [TaskErrorCode.TaskNotFound]: HttpStatus.NotFound,
  [TaskErrorCode.CompletionNotFound]: HttpStatus.NotFound,
};

const STATUS_BY_CALENDAR_ERROR: Record<CalendarErrorCode, number> = {
  [CalendarErrorCode.InvalidColumnName]: HttpStatus.BadRequest,
  [CalendarErrorCode.InvalidTitle]: HttpStatus.BadRequest,
  [CalendarErrorCode.InvalidDay]: HttpStatus.BadRequest,
  [CalendarErrorCode.InvalidTime]: HttpStatus.BadRequest,
  [CalendarErrorCode.UnknownColumn]: HttpStatus.BadRequest,
  [CalendarErrorCode.ColumnHasDates]: HttpStatus.Conflict,
  [CalendarErrorCode.ColumnNotFound]: HttpStatus.NotFound,
  [CalendarErrorCode.EntryNotFound]: HttpStatus.NotFound,
};

const STATUS_BY_NOTE_ERROR: Record<NoteErrorCode, number> = {
  [NoteErrorCode.InvalidText]: HttpStatus.BadRequest,
  [NoteErrorCode.NoteNotFound]: HttpStatus.NotFound,
};

export class TooManyAttemptsError extends Error {
  readonly code = "TOO_MANY_ATTEMPTS";

  constructor() {
    super("Too many tries. Wait a minute and try again.");
    this.name = "TooManyAttemptsError";
  }
}

type DomainError = HouseholdError | ExpenseError | AccountError | TaskError | NotificationError | MealError | CalendarError | NoteError;

function isDomainError(error: unknown): error is DomainError {
  return (
    error instanceof HouseholdError ||
    error instanceof ExpenseError ||
    error instanceof AccountError ||
    error instanceof TaskError ||
    error instanceof NotificationError ||
    error instanceof MealError ||
    error instanceof CalendarError ||
    error instanceof NoteError
  );
}

function statusOf(error: DomainError) {
  if (error instanceof HouseholdError) {
    return STATUS_BY_HOUSEHOLD_ERROR[error.code];
  }
  if (error instanceof TaskError) {
    return STATUS_BY_TASK_ERROR[error.code];
  }
  if (error instanceof NotificationError) {
    return STATUS_BY_NOTIFICATION_ERROR[error.code];
  }
  if (error instanceof MealError) {
    return STATUS_BY_MEAL_ERROR[error.code];
  }
  if (error instanceof CalendarError) {
    return STATUS_BY_CALENDAR_ERROR[error.code];
  }
  if (error instanceof NoteError) {
    return STATUS_BY_NOTE_ERROR[error.code];
  }
  return error instanceof AccountError
    ? STATUS_BY_ACCOUNT_ERROR[error.code]
    : STATUS_BY_EXPENSE_ERROR[error.code];
}

// Domain errors reach the web app as { error, message } so it can show the message as is.
export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof TooManyAttemptsError) {
      return reply.status(HttpStatus.TooManyRequests).send({ error: error.code, message: error.message });
    }
    if (isDomainError(error)) {
      return reply.status(statusOf(error)).send({ error: error.code, message: error.message });
    }
    return reply.send(error);
  });
}
