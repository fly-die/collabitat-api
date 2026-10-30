import type { AccountRepository } from "../accounts/account-repository.js";
import type { SessionRepository } from "../sessions/session-repository.js";
import { createSessionToken } from "../sessions/session-token.js";
import type { Household } from "./household.js";

// What a member sees of their household, and how a new session for them starts.
export function householdViews(accountRepository: AccountRepository, sessionRepository: SessionRepository) {
  async function viewFor(household: Household, currentMemberId: string) {
    return {
      ...household,
      currentMemberId,
      currentMemberHasAccount: await accountRepository.hasAccount(currentMemberId),
    };
  }

  async function startSession(household: Household, memberId: string) {
    const { token, tokenHash } = createSessionToken();
    await sessionRepository.create(tokenHash, memberId);
    return { token, household: await viewFor(household, memberId) };
  }

  return { viewFor, startSession };
}

export type HouseholdViews = ReturnType<typeof householdViews>;
