import type { FastifyInstance } from "fastify";
import { AccountError, AccountErrorCode } from "./accounts/account-errors.js";
import { ExpenseError, ExpenseErrorCode } from "./expenses/expense-errors.js";
import { HouseholdError, HouseholdErrorCode } from "./households/household-errors.js";
import { HttpStatus } from "./http-status.js";

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
};

export class TooManyAttemptsError extends Error {
  readonly code = "TOO_MANY_ATTEMPTS";

  constructor() {
    super("Too many tries. Wait a minute and try again.");
    this.name = "TooManyAttemptsError";
  }
}

type DomainError = HouseholdError | ExpenseError | AccountError;

function isDomainError(error: unknown): error is DomainError {
  return error instanceof HouseholdError || error instanceof ExpenseError || error instanceof AccountError;
}

function statusOf(error: DomainError) {
  if (error instanceof HouseholdError) {
    return STATUS_BY_HOUSEHOLD_ERROR[error.code];
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
