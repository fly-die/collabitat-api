import type { FastifyRequest } from "fastify";
import { HouseholdError, HouseholdErrorCode } from "../households/household-errors.js";
import type { HouseholdRepository } from "../households/household-repository.js";
import type { SessionRepository } from "./session-repository.js";
import { hashSessionToken } from "./session-token.js";

const BEARER_PREFIX = "Bearer ";

// Finds who a session token belongs to; undefined when it's unknown or the member was removed.
export function createTokenAuthenticator(
  householdRepository: HouseholdRepository,
  sessionRepository: SessionRepository,
) {
  return async function authenticateToken(token: string) {
    const tokenHash = hashSessionToken(token);
    const memberId = await sessionRepository.findMemberId(tokenHash);
    // A removed member's session no longer finds a household.
    const household = memberId ? await householdRepository.findByMemberId(memberId) : undefined;
    return memberId && household ? { household, currentMemberId: memberId, tokenHash } : undefined;
  };
}

export type TokenAuthenticator = ReturnType<typeof createTokenAuthenticator>;

export function createAuthenticator(
  householdRepository: HouseholdRepository,
  sessionRepository: SessionRepository,
) {
  const authenticateToken = createTokenAuthenticator(householdRepository, sessionRepository);
  return async function authenticate(request: FastifyRequest) {
    const authorization = request.headers.authorization;
    const session = authorization?.startsWith(BEARER_PREFIX)
      ? await authenticateToken(authorization.slice(BEARER_PREFIX.length))
      : undefined;
    if (!session) {
      throw new HouseholdError(HouseholdErrorCode.Unauthorized, "Please join a household first.");
    }
    return session;
  };
}

export type Authenticate = ReturnType<typeof createAuthenticator>;
