import type { FastifyInstance } from "fastify";
import { MAX_MEMBERS, type Household } from "../households/household.js";
import { HttpStatus } from "../http-status.js";
import type { Authenticate } from "../sessions/authenticate.js";
import { ExpenseError, ExpenseErrorCode } from "./expense-errors.js";
import type { ExpenseRepository } from "./expense-repository.js";
import { MAX_DESCRIPTION_LENGTH, calculateBalances, createExpense, type NewExpense } from "./expense.js";
import type { SettlementRepository } from "./settlement-repository.js";
import { createSettlement, simplifyDebts, type NewSettlement } from "./settlement.js";

const ID_MAX_LENGTH = 64;
const ISO_DATE_LENGTH = 10;

const idProperty = { type: "string", maxLength: ID_MAX_LENGTH } as const;

const newExpenseBodySchema = {
  type: "object",
  required: ["description", "amountCents", "paidByMemberId", "splitBetweenMemberIds", "spentOn"],
  additionalProperties: false,
  properties: {
    description: { type: "string", maxLength: MAX_DESCRIPTION_LENGTH * 2 },
    amountCents: { type: "number" },
    paidByMemberId: idProperty,
    splitBetweenMemberIds: { type: "array", maxItems: MAX_MEMBERS, items: idProperty },
    spentOn: { type: "string", maxLength: ISO_DATE_LENGTH },
  },
} as const;

const newSettlementBodySchema = {
  type: "object",
  required: ["fromMemberId", "toMemberId", "amountCents", "settledOn"],
  additionalProperties: false,
  properties: {
    fromMemberId: idProperty,
    toMemberId: idProperty,
    amountCents: { type: "number" },
    settledOn: { type: "string", maxLength: ISO_DATE_LENGTH },
  },
} as const;

const idParamsSchema = (name: string) =>
  ({
    type: "object",
    required: [name],
    properties: { [name]: { type: "string", format: "uuid" } },
  }) as const;

interface ExpenseParams {
  expenseId: string;
}

interface SettlementParams {
  settlementId: string;
}

export interface ExpenseRouteDependencies {
  authenticate: Authenticate;
  expenseRepository: ExpenseRepository;
  settlementRepository: SettlementRepository;
}

export function expenseRoutes({ authenticate, expenseRepository, settlementRepository }: ExpenseRouteDependencies) {
  // Every change answers with the whole money view, so the app never shows stale balances.
  async function moneyView(household: Household) {
    const [expenses, settlements] = await Promise.all([
      expenseRepository.listByHousehold(household.id),
      settlementRepository.listByHousehold(household.id),
    ]);
    const balances = calculateBalances(household.members, expenses, settlements);
    return { expenses, settlements, balances, transfers: simplifyDebts(balances) };
  }

  return async function register(app: FastifyInstance) {
    app.get("/household/expenses", async (request) => {
      const { household } = await authenticate(request);
      return moneyView(household);
    });

    app.post<{ Body: NewExpense }>(
      "/household/expenses",
      { schema: { body: newExpenseBodySchema } },
      async (request, reply) => {
        const { household } = await authenticate(request);
        await expenseRepository.add(household.id, createExpense(household, request.body));
        return reply.status(HttpStatus.Created).send(await moneyView(household));
      },
    );

    app.delete<{ Params: ExpenseParams }>(
      "/household/expenses/:expenseId",
      { schema: { params: idParamsSchema("expenseId") } },
      async (request) => {
        const { household } = await authenticate(request);
        if (!(await expenseRepository.remove(household.id, request.params.expenseId))) {
          throw new ExpenseError(ExpenseErrorCode.ExpenseNotFound, "That expense is already gone.");
        }
        return moneyView(household);
      },
    );

    app.post<{ Body: NewSettlement }>(
      "/household/settlements",
      { schema: { body: newSettlementBodySchema } },
      async (request, reply) => {
        const { household } = await authenticate(request);
        await settlementRepository.add(household.id, createSettlement(household, request.body));
        return reply.status(HttpStatus.Created).send(await moneyView(household));
      },
    );

    app.delete<{ Params: SettlementParams }>(
      "/household/settlements/:settlementId",
      { schema: { params: idParamsSchema("settlementId") } },
      async (request) => {
        const { household } = await authenticate(request);
        if (!(await settlementRepository.remove(household.id, request.params.settlementId))) {
          throw new ExpenseError(ExpenseErrorCode.SettlementNotFound, "That payment is already gone.");
        }
        return moneyView(household);
      },
    );
  };
}
