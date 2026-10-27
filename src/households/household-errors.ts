export const HouseholdErrorCode = {
  InvalidName: "INVALID_NAME",
  DuplicateMember: "DUPLICATE_MEMBER",
  MemberLimitReached: "MEMBER_LIMIT_REACHED",
  MemberNotFound: "MEMBER_NOT_FOUND",
  HouseholdNotFound: "HOUSEHOLD_NOT_FOUND",
} as const;

export type HouseholdErrorCode = (typeof HouseholdErrorCode)[keyof typeof HouseholdErrorCode];

export class HouseholdError extends Error {
  constructor(
    readonly code: HouseholdErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "HouseholdError";
  }
}
