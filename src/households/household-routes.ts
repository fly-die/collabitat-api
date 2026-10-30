import type { FastifyInstance } from "fastify";
import type { ExpenseRepository } from "../expenses/expense-repository.js";
import { involvesMember } from "../expenses/expense.js";
import { HttpStatus } from "../http-status.js";
import type { Authenticate } from "../sessions/authenticate.js";
import { createSessionToken } from "../sessions/session-token.js";
import type { SessionRepository } from "../sessions/session-repository.js";
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

const nameProperty = { type: "string", maxLength: MAX_NAME_LENGTH * 2 } as const;

const nameBodySchema = {
  type: "object",
  required: ["name"],
  additionalProperties: false,
  properties: { name: nameProperty },
} as const;

const createHouseholdBodySchema = {
  type: "object",
  required: ["name", "memberName"],
  additionalProperties: false,
  properties: { name: nameProperty, memberName: nameProperty },
} as const;

interface NameBody {
  name: string;
}

interface CreateHouseholdBody extends NameBody {
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
  householdRepository: HouseholdRepository;
  sessionRepository: SessionRepository;
  expenseRepository: ExpenseRepository;
}

function toHouseholdView(household: Household, currentMemberId: string) {
  return { ...household, currentMemberId };
}

export function householdRoutes({
  authenticate,
  householdRepository,
  sessionRepository,
  expenseRepository,
}: HouseholdRouteDependencies) {
  // Removing someone would rewrite the history of what they paid and owe.
  async function ensureNoExpensesInvolve(household: Household, memberId: string) {
    const expenses = await expenseRepository.listByHousehold(household.id);
    const member = household.members.find((candidate) => candidate.id === memberId);
    if (member && expenses.some((expense) => involvesMember(expense, memberId))) {
      throw new HouseholdError(
        HouseholdErrorCode.MemberHasExpenses,
        `${member.name} is part of some expenses, so they stay in the household.`,
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

  async function saveAndStartSession({ household, member }: HouseholdWithMember) {
    await householdRepository.save(household);
    const { token, tokenHash } = createSessionToken();
    await sessionRepository.create(tokenHash, member.id);
    return { token, household: toHouseholdView(household, member.id) };
  }

  return async function register(app: FastifyInstance) {
    app.post<{ Body: CreateHouseholdBody }>(
      "/households",
      { schema: { body: createHouseholdBodySchema } },
      async (request, reply) => {
        const created = createHousehold(request.body.name, request.body.memberName);
        return reply.status(HttpStatus.Created).send(await saveAndStartSession(created));
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

    app.post<{ Params: InviteParams; Body: NameBody }>(
      "/invites/:inviteCode/members",
      { schema: { body: nameBodySchema } },
      async (request, reply) => {
        const household = await loadInvite(request.params.inviteCode);
        const joined = joinAsNewMember(household, request.body.name);
        return reply.status(HttpStatus.Created).send(await saveAndStartSession(joined));
      },
    );

    app.post<{ Params: InviteParams & MemberParams }>(
      "/invites/:inviteCode/members/:memberId/join",
      async (request, reply) => {
        const household = await loadInvite(request.params.inviteCode);
        const joined = joinAsExistingMember(household, request.params.memberId);
        return reply.status(HttpStatus.Created).send(await saveAndStartSession(joined));
      },
    );

    app.get("/household", async (request) => {
      const { household, currentMemberId } = await authenticate(request);
      return toHouseholdView(household, currentMemberId);
    });

    app.post<{ Body: NameBody }>(
      "/household/members",
      { schema: { body: nameBodySchema } },
      async (request, reply) => {
        const { household, currentMemberId } = await authenticate(request);
        const updated = addMember(household, request.body.name);
        await householdRepository.save(updated);
        return reply.status(HttpStatus.Created).send(toHouseholdView(updated, currentMemberId));
      },
    );

    app.delete<{ Params: MemberParams }>("/household/members/:memberId", async (request) => {
      const { household, currentMemberId } = await authenticate(request);
      const updated = removeMember(household, request.params.memberId, currentMemberId);
      await ensureNoExpensesInvolve(household, request.params.memberId);
      await householdRepository.save(updated);
      return toHouseholdView(updated, currentMemberId);
    });
  };
}
