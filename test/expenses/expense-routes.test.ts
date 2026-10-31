import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { ExpenseErrorCode } from "../../src/expenses/expense-errors.js";
import { HouseholdErrorCode } from "../../src/households/household-errors.js";
import { HttpStatus } from "../../src/http-status.js";
import { newCredentials } from "../support/credentials.js";

type App = ReturnType<typeof buildApp>;

interface Household {
  currentMemberId: string;
  members: { id: string; name: string }[];
}

interface MoneyView {
  expenses: { id: string; description: string; amountCents: number; spentOn: string }[];
  settlements: { id: string; fromMemberId: string; toMemberId: string; amountCents: number }[];
  balances: { memberId: string; balanceCents: number }[];
  transfers: { fromMemberId: string; toMemberId: string; amountCents: number }[];
}

function authorized(token: string) {
  return { authorization: `Bearer ${token}` };
}

async function householdWithLea(app: App) {
  const created = await app.inject({
    method: "POST",
    url: "/households",
    payload: { name: "Langstrasse 12", memberName: "Mia", ...newCredentials("mia") },
  });
  const { token } = created.json();
  const withLea = await app.inject({
    method: "POST",
    url: "/household/members",
    headers: authorized(token),
    payload: { name: "Lea" },
  });
  const household: Household = withLea.json();
  const [mia, lea] = household.members;
  return { token, mia, lea };
}

describe("expense routes", () => {
  let app: App;
  let token: string;
  let mia: Household["members"][number];
  let lea: Household["members"][number];

  function addExpense(payload: Record<string, unknown> = {}) {
    return app.inject({
      method: "POST",
      url: "/household/expenses",
      headers: authorized(token),
      payload: {
        description: "Groceries",
        amountCents: 3000,
        paidByMemberId: mia.id,
        splitBetweenMemberIds: [mia.id, lea.id],
        spentOn: "2026-10-30",
        ...payload,
      },
    });
  }

  beforeEach(async () => {
    app = buildApp();
    ({ token, mia, lea } = await householdWithLea(app));
  });

  afterEach(() => app.close());

  it("adds expenses and answers with the newest first and fresh balances", async () => {
    await addExpense({ description: "Rent share", spentOn: "2026-10-01" });
    const response = await addExpense({ amountCents: 1001, paidByMemberId: lea.id });

    expect(response.statusCode).toBe(HttpStatus.Created);
    const view: MoneyView = response.json();
    expect(view.expenses.map((expense) => expense.description)).toEqual(["Groceries", "Rent share"]);
    expect(view.balances).toEqual([
      { memberId: mia.id, balanceCents: 1500 - 501 },
      { memberId: lea.id, balanceCents: -1500 + 501 },
    ]);

    const listed = await app.inject({ url: "/household/expenses", headers: authorized(token) });
    expect(listed.json()).toEqual(view);
  });

  it("explains why an expense was rejected", async () => {
    const response = await addExpense({ amountCents: 0 });

    expect(response.statusCode).toBe(HttpStatus.BadRequest);
    expect(response.json()).toEqual({
      error: ExpenseErrorCode.InvalidAmount,
      message: "Enter an amount between 0.01 and 100000.",
    });
  });

  it("deletes an expense and says so when it is already gone", async () => {
    const { expenses }: MoneyView = (await addExpense()).json();
    const deleteExpense = () =>
      app.inject({
        method: "DELETE",
        url: `/household/expenses/${expenses[0].id}`,
        headers: authorized(token),
      });

    const deleted = await deleteExpense();
    expect(deleted.statusCode).toBe(HttpStatus.Ok);
    expect(deleted.json().expenses).toEqual([]);
    expect((await deleteExpense()).json().error).toBe(ExpenseErrorCode.ExpenseNotFound);
  });

  it("only shows a household its own expenses", async () => {
    await addExpense();
    const other = await householdWithLea(app);

    const response = await app.inject({ url: "/household/expenses", headers: authorized(other.token) });

    expect(response.json().expenses).toEqual([]);
  });

  it("needs a session", async () => {
    const response = await app.inject({ url: "/household/expenses" });

    expect(response.statusCode).toBe(HttpStatus.Unauthorized);
  });

  it("keeps a flatmate who is part of an expense in the household", async () => {
    await addExpense();

    const response = await app.inject({
      method: "DELETE",
      url: `/household/members/${lea.id}`,
      headers: authorized(token),
    });

    expect(response.statusCode).toBe(HttpStatus.Conflict);
    expect(response.json()).toEqual({
      error: HouseholdErrorCode.MemberHasExpenses,
      message: "Lea is part of some expenses or payments, so they stay in the household.",
    });
  });

  describe("settling up", () => {
    function settle(payload: Record<string, unknown>) {
      return app.inject({
        method: "POST",
        url: "/household/settlements",
        headers: authorized(token),
        payload: { settledOn: "2026-10-31", ...payload },
      });
    }

    it("suggests who pays whom, and paying it squares everyone", async () => {
      const { transfers }: MoneyView = (await addExpense()).json();
      expect(transfers).toEqual([{ fromMemberId: lea.id, toMemberId: mia.id, amountCents: 1500 }]);

      const response = await settle(transfers[0]);
      const view: MoneyView = response.json();

      expect(response.statusCode).toBe(HttpStatus.Created);
      expect(view.transfers).toEqual([]);
      expect(view.balances.map((balance) => balance.balanceCents)).toEqual([0, 0]);
      expect(view.settlements).toEqual([
        {
          id: expect.any(String),
          fromMemberId: lea.id,
          toMemberId: mia.id,
          amountCents: 1500,
          settledOn: "2026-10-31",
          createdAt: expect.any(String),
        },
      ]);
    });

    it("keeps the rest open after a partial payment", async () => {
      await addExpense();

      const view: MoneyView = (await settle({ fromMemberId: lea.id, toMemberId: mia.id, amountCents: 1000 })).json();

      expect(view.transfers).toEqual([{ fromMemberId: lea.id, toMemberId: mia.id, amountCents: 500 }]);
    });

    it("deletes a payment and says so when it is already gone", async () => {
      await addExpense();
      const { settlements }: MoneyView = (
        await settle({ fromMemberId: lea.id, toMemberId: mia.id, amountCents: 1500 })
      ).json();
      const deletePayment = () =>
        app.inject({
          method: "DELETE",
          url: `/household/settlements/${settlements[0].id}`,
          headers: authorized(token),
        });

      expect((await deletePayment()).json().transfers).toEqual([
        { fromMemberId: lea.id, toMemberId: mia.id, amountCents: 1500 },
      ]);
      expect((await deletePayment()).json().error).toBe(ExpenseErrorCode.SettlementNotFound);
    });

    it("rejects a payment to yourself", async () => {
      const response = await settle({ fromMemberId: mia.id, toMemberId: mia.id, amountCents: 500 });

      expect(response.statusCode).toBe(HttpStatus.BadRequest);
      expect(response.json().error).toBe(ExpenseErrorCode.InvalidSettlement);
    });

    it("keeps a flatmate who only took part in a payment", async () => {
      await settle({ fromMemberId: mia.id, toMemberId: lea.id, amountCents: 500 });

      const response = await app.inject({
        method: "DELETE",
        url: `/household/members/${lea.id}`,
        headers: authorized(token),
      });

      expect(response.statusCode).toBe(HttpStatus.Conflict);
    });
  });
});
