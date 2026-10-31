export const ExpenseErrorCode = {
  InvalidDescription: "INVALID_DESCRIPTION",
  InvalidAmount: "INVALID_AMOUNT",
  InvalidDate: "INVALID_DATE",
  UnknownPayer: "UNKNOWN_PAYER",
  InvalidSplit: "INVALID_SPLIT",
  ExpenseNotFound: "EXPENSE_NOT_FOUND",
  InvalidSettlement: "INVALID_SETTLEMENT",
  SettlementNotFound: "SETTLEMENT_NOT_FOUND",
} as const;

export type ExpenseErrorCode = (typeof ExpenseErrorCode)[keyof typeof ExpenseErrorCode];

export class ExpenseError extends Error {
  constructor(
    readonly code: ExpenseErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ExpenseError";
  }
}
