import type { FastifyInstance } from "fastify";
import { MAX_MEMBERS, type Household } from "../households/household.js";
import { HttpStatus } from "../http-status.js";
import type { Authenticate } from "../sessions/authenticate.js";
import { ExpenseError, ExpenseErrorCode } from "./expense-errors.js";
import type { ExpenseRepository } from "./expense-repository.js";
import { MAX_DESCRIPTION_LENGTH, calculateBalances, createExpense, type NewExpense } from "./expense.js";

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

const expenseParamsSchema = {
  type: "object",
  required: ["expenseId"],
  properties: { expenseId: { type: "string", format: "uuid" } },
} as const;

interface ExpenseParams {
  expenseId: string;
}

export interface ExpenseRouteDependencies {
  authenticate: Authenticate;
  expenseRepository: ExpenseRepository;
}

export function expenseRoutes({ authenticate, expenseRepository }: ExpenseRouteDependencies) {
  // Every change answers with the whole money view, so the app never shows stale balances.
  async function moneyView(household: Household) {
    const expenses = await expenseRepository.listByHousehold(household.id);
    return { expenses, balances: calculateBalances(household.members, expenses) };
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
      { schema: { params: expenseParamsSchema } },
      async (request) => {
        const { household } = await authenticate(request);
        if (!(await expenseRepository.remove(household.id, request.params.expenseId))) {
          throw new ExpenseError(ExpenseErrorCode.ExpenseNotFound, "That expense is already gone.");
        }
        return moneyView(household);
      },
    );
  };
}
