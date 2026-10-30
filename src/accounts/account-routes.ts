import type { FastifyInstance, FastifyRequest } from "fastify";
import type { HouseholdRepository } from "../households/household-repository.js";
import type { HouseholdViews } from "../households/household-view.js";
import { HttpStatus } from "../http-status.js";
import type { Authenticate } from "../sessions/authenticate.js";
import type { SessionRepository } from "../sessions/session-repository.js";
import { AccountError, AccountErrorCode } from "./account-errors.js";
import type { AccountRepository } from "./account-repository.js";
import type { AccountService } from "./account-service.js";
import { MAX_EMAIL_LENGTH, MAX_PASSWORD_LENGTH, type Credentials } from "./account.js";

export const LOGIN_ATTEMPTS_PER_WINDOW = 5;
const LOGIN_WINDOW = "1 minute";

export const credentialsBodySchema = {
  type: "object",
  required: ["email", "password"],
  additionalProperties: false,
  properties: {
    email: { type: "string", maxLength: MAX_EMAIL_LENGTH * 2 },
    password: { type: "string", maxLength: MAX_PASSWORD_LENGTH },
  },
} as const;

export interface AccountRouteDependencies {
  authenticate: Authenticate;
  accounts: AccountService;
  accountRepository: AccountRepository;
  householdRepository: HouseholdRepository;
  sessionRepository: SessionRepository;
  views: HouseholdViews;
}

// Slows down guessing one person's password, wherever the guesses come from.
function loginAttemptKey(request: FastifyRequest) {
  const { email } = (request.body ?? {}) as Partial<Credentials>;
  return `login:${String(email ?? "").trim().toLowerCase()}`;
}

export function accountRoutes({
  authenticate,
  accounts,
  accountRepository,
  householdRepository,
  sessionRepository,
  views,
}: AccountRouteDependencies) {
  async function firstHouseholdOf(accountId: string) {
    for (const memberId of await accountRepository.findMemberIds(accountId)) {
      const household = await householdRepository.findByMemberId(memberId);
      if (household) {
        return { household, memberId };
      }
    }
    throw new AccountError(
      AccountErrorCode.NoHousehold,
      "You're not in a household anymore. Ask a flatmate for a new invite link.",
    );
  }

  return async function register(app: FastifyInstance) {
    app.post<{ Body: Credentials }>(
      "/sessions",
      {
        schema: { body: credentialsBodySchema },
        config: {
          rateLimit: {
            max: LOGIN_ATTEMPTS_PER_WINDOW,
            timeWindow: LOGIN_WINDOW,
            hook: "preHandler",
            keyGenerator: loginAttemptKey,
          },
        },
      },
      async (request, reply) => {
        const account = await accounts.logIn(request.body);
        const { household, memberId } = await firstHouseholdOf(account.id);
        return reply.status(HttpStatus.Created).send(await views.startSession(household, memberId));
      },
    );

    app.delete("/session", async (request) => {
      const { tokenHash } = await authenticate(request);
      await sessionRepository.remove(tokenHash);
      return { loggedOut: true };
    });

    app.post<{ Body: Credentials }>(
      "/household/account",
      { schema: { body: credentialsBodySchema } },
      async (request, reply) => {
        const { household, currentMemberId } = await authenticate(request);
        if (await accountRepository.hasAccount(currentMemberId)) {
          throw new AccountError(AccountErrorCode.AccountExists, "You already have an account.");
        }
        const account = await accounts.prepare(request.body);
        await accountRepository.createForMember(account, currentMemberId);
        return reply.status(HttpStatus.Created).send(await views.viewFor(household, currentMemberId));
      },
    );
  };
}
