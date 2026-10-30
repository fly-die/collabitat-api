export const AccountErrorCode = {
  InvalidEmail: "INVALID_EMAIL",
  InvalidPassword: "INVALID_PASSWORD",
  EmailTaken: "EMAIL_TAKEN",
  WrongCredentials: "WRONG_CREDENTIALS",
  NoHousehold: "NO_HOUSEHOLD",
  AccountExists: "ACCOUNT_EXISTS",
} as const;

export type AccountErrorCode = (typeof AccountErrorCode)[keyof typeof AccountErrorCode];

export class AccountError extends Error {
  constructor(
    readonly code: AccountErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AccountError";
  }
}
