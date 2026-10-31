import type { FastifyInstance } from "fastify";
import type { AccountRepository } from "../accounts/account-repository.js";
import { credentialsBodySchema } from "../accounts/account-routes.js";
import type { AccountService } from "../accounts/account-service.js";
import type { Credentials } from "../accounts/account.js";
import type { ExpenseRepository } from "../expenses/expense-repository.js";
import { involvesMember } from "../expenses/expense.js";
import type { SettlementRepository } from "../expenses/settlement-repository.js";
import { HttpStatus } from "../http-status.js";
import type { Authenticate } from "../sessions/authenticate.js";
import {
  MAX_NAME_LENGTH,
  addMember,
  createHousehold,
  joinAsExistingMember,
  joinAsNewMember,
  removeMember,
  type Household,
  type HouseholdWithMember,
} from "./household.js";
import { HouseholdError, HouseholdErrorCode } from "./household-errors.js";
import type { HouseholdRepository } from "./household-repository.js";
import type { HouseholdViews } from "./household-view.js";

const nameProperty = { type: "string", maxLength: MAX_NAME_LENGTH * 2 } as const;

const nameBodySchema = {
  type: "object",
  required: ["name"],
  additionalProperties: false,
  properties: { name: nameProperty },
} as const;

const joinWithNameBodySchema = {
  ...credentialsBodySchema,
  required: [...credentialsBodySchema.required, "name"],
  properties: { ...credentialsBodySchema.properties, name: nameProperty },
} as const;

const createHouseholdBodySchema = {
  ...credentialsBodySchema,
  required: [...credentialsBodySchema.required, "name", "memberName"],
  properties: { ...credentialsBodySchema.properties, name: nameProperty, memberName: nameProperty },
} as const;

interface NameBody {
  name: string;
}

interface CreateHouseholdBody extends NameBody, Credentials {
  memberName: string;
}

interface InviteParams {
  inviteCode: string;
}

interface MemberParams {
  memberId: string;
}

export interface HouseholdRouteDependencies {
  authenticate: Authenticate;
  accounts: AccountService;
  accountRepository: AccountRepository;
  householdRepository: HouseholdRepository;
  expenseRepository: ExpenseRepository;
  settlementRepository: SettlementRepository;
  views: HouseholdViews;
}

export function householdRoutes({
  authenticate,
  accounts,
  accountRepository,
  householdRepository,
  expenseRepository,
  settlementRepository,
  views,
}: HouseholdRouteDependencies) {
  // Removing someone would rewrite the history of what they paid and owe.
  async function ensureNoMoneyInvolves(household: Household, memberId: string) {
    const [expenses, settlements] = await Promise.all([
      expenseRepository.listByHousehold(household.id),
      settlementRepository.listByHousehold(household.id),
    ]);
    const member = household.members.find((candidate) => candidate.id === memberId);
    const isInvolved =
      expenses.some((expense) => involvesMember(expense, memberId)) ||
      settlements.some((settlement) => settlement.fromMemberId === memberId || settlement.toMemberId === memberId);
    if (member && isInvolved) {
      throw new HouseholdError(
        HouseholdErrorCode.MemberHasExpenses,
        `${member.name} is part of some expenses or payments, so they stay in the household.`,
      );
    }
  }

  async function loadInvite(inviteCode: string) {
    const household = await householdRepository.findByInviteCode(inviteCode);
    if (!household) {
      throw new HouseholdError(
        HouseholdErrorCode.InviteNotFound,
        "This invite link doesn't work. Ask a flatmate for a new one.",
      );
    }
    return household;
  }

  // Everyone who creates or joins a household does it with their own account.
  async function saveWithAccountAndStartSession({ household, member }: HouseholdWithMember, credentials: Credentials) {
    const account = await accounts.prepare(credentials);
    await householdRepository.save(household);
    await accountRepository.createForMember(account, member.id);
    return views.startSession(household, member.id);
  }

  return async function register(app: FastifyInstance) {
    app.post<{ Body: CreateHouseholdBody }>(
      "/households",
      { schema: { body: createHouseholdBodySchema } },
      async (request, reply) => {
        const created = createHousehold(request.body.name, request.body.memberName);
        return reply.status(HttpStatus.Created).send(await saveWithAccountAndStartSession(created, request.body));
      },
    );

    app.get<{ Params: InviteParams }>("/invites/:inviteCode", async (request) => {
      const household = await loadInvite(request.params.inviteCode);
      return {
        householdId: household.id,
        householdName: household.name,
        membersToJoin: household.members
          .filter((member) => !member.hasJoined)
          .map(({ id, name }) => ({ id, name })),
      };
    });

    app.post<{ Params: InviteParams; Body: NameBody & Credentials }>(
      "/invites/:inviteCode/members",
      { schema: { body: joinWithNameBodySchema } },
      async (request, reply) => {
        const household = await loadInvite(request.params.inviteCode);
        const joined = joinAsNewMember(household, request.body.name);
        return reply.status(HttpStatus.Created).send(await saveWithAccountAndStartSession(joined, request.body));
      },
    );

    app.post<{ Params: InviteParams & MemberParams; Body: Credentials }>(
      "/invites/:inviteCode/members/:memberId/join",
      { schema: { body: credentialsBodySchema } },
      async (request, reply) => {
        const household = await loadInvite(request.params.inviteCode);
        const joined = joinAsExistingMember(household, request.params.memberId);
        return reply.status(HttpStatus.Created).send(await saveWithAccountAndStartSession(joined, request.body));
      },
    );

    app.get("/household", async (request) => {
      const { household, currentMemberId } = await authenticate(request);
      return views.viewFor(household, currentMemberId);
    });

    app.post<{ Body: NameBody }>(
      "/household/members",
      { schema: { body: nameBodySchema } },
      async (request, reply) => {
        const { household, currentMemberId } = await authenticate(request);
        const updated = addMember(household, request.body.name);
        await householdRepository.save(updated);
        return reply.status(HttpStatus.Created).send(await views.viewFor(updated, currentMemberId));
      },
    );

    app.delete<{ Params: MemberParams }>("/household/members/:memberId", async (request) => {
      const { household, currentMemberId } = await authenticate(request);
      const updated = removeMember(household, request.params.memberId, currentMemberId);
      await ensureNoMoneyInvolves(household, request.params.memberId);
      await householdRepository.save(updated);
      return views.viewFor(updated, currentMemberId);
    });
  };
}
