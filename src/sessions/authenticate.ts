import type { FastifyRequest } from "fastify";
import { HouseholdError, HouseholdErrorCode } from "../households/household-errors.js";
import type { HouseholdRepository } from "../households/household-repository.js";
import type { SessionRepository } from "./session-repository.js";
import { hashSessionToken } from "./session-token.js";

const BEARER_PREFIX = "Bearer ";

export function createAuthenticator(
  householdRepository: HouseholdRepository,
  sessionRepository: SessionRepository,
) {
  return async function authenticate(request: FastifyRequest) {
    const authorization = request.headers.authorization;
    const memberId = authorization?.startsWith(BEARER_PREFIX)
      ? await sessionRepository.findMemberId(
          hashSessionToken(authorization.slice(BEARER_PREFIX.length)),
        )
      : undefined;
    // A removed member's session no longer finds a household.
    const household = memberId ? await householdRepository.findByMemberId(memberId) : undefined;
    if (!memberId || !household) {
      throw new HouseholdError(HouseholdErrorCode.Unauthorized, "Please join a household first.");
    }
    return { household, currentMemberId: memberId };
  };
}

export type Authenticate = ReturnType<typeof createAuthenticator>;
