import { describe, expect, it } from "vitest";
import { addMember, createHousehold } from "../../src/households/household.js";
import { ExpenseErrorCode } from "../../src/expenses/expense-errors.js";
import {
  calculateBalances,
  createExpense,
  splitEqually,
  type NewExpense,
} from "../../src/expenses/expense.js";

function householdWithMiaLeaNoah() {
  const { household } = createHousehold("Langstrasse 12", "Mia");
  const withNoah = addMember(addMember(household, "Lea"), "Noah");
  const [mia, lea, noah] = withNoah.members;
  return { household: withNoah, mia, lea, noah };
}

describe("expenses", () => {
  const { household, mia, lea, noah } = householdWithMiaLeaNoah();
  const everyone = [mia.id, lea.id, noah.id];

  function expense(overrides: Partial<NewExpense> = {}) {
    return createExpense(household, {
      description: "Groceries",
      amountCents: 3000,
      paidByMemberId: mia.id,
      splitBetweenMemberIds: everyone,
      spentOn: "2026-10-30",
      ...overrides,
    });
  }

  it("splits an uneven amount so the shares add up to the exact total", () => {
    const shares = splitEqually(1000, everyone);

    expect(shares.map((share) => share.amountCents)).toEqual([334, 333, 333]);
  });

  it("splits in household order, however the request lists the members", () => {
    const created = expense({ amountCents: 100, splitBetweenMemberIds: [noah.id, mia.id, noah.id] });

    expect(created.shares).toEqual([
      { memberId: mia.id, amountCents: 50 },
      { memberId: noah.id, amountCents: 50 },
    ]);
  });

  it("tidies the description", () => {
    expect(expense({ description: "  Toilet   paper " }).description).toBe("Toilet paper");
  });

  it.each([
    ["a blank description", { description: "  " }, ExpenseErrorCode.InvalidDescription],
    ["a zero amount", { amountCents: 0 }, ExpenseErrorCode.InvalidAmount],
    ["a fractional cent", { amountCents: 12.5 }, ExpenseErrorCode.InvalidAmount],
    ["an amount above the limit", { amountCents: 10_000_001 }, ExpenseErrorCode.InvalidAmount],
    ["an impossible date", { spentOn: "2026-02-30" }, ExpenseErrorCode.InvalidDate],
    ["a payer from elsewhere", { paidByMemberId: "someone-else" }, ExpenseErrorCode.UnknownPayer],
    ["nobody to split with", { splitBetweenMemberIds: [] }, ExpenseErrorCode.InvalidSplit],
    ["a stranger in the split", { splitBetweenMemberIds: [mia.id, "someone-else"] }, ExpenseErrorCode.InvalidSplit],
  ])("rejects %s", (_label, overrides, code) => {
    expect(() => expense(overrides)).toThrow(expect.objectContaining({ code }));
  });

  it("works out who is owed and who owes, adding up to zero", () => {
    const expenses = [
      expense({ amountCents: 3000, paidByMemberId: mia.id }),
      expense({ amountCents: 1200, paidByMemberId: lea.id, splitBetweenMemberIds: [lea.id, noah.id] }),
    ];

    const balances = calculateBalances(household.members, expenses);

    expect(balances).toEqual([
      { memberId: mia.id, balanceCents: 2000 },
      { memberId: lea.id, balanceCents: -400 },
      { memberId: noah.id, balanceCents: -1600 },
    ]);
    expect(balances.reduce((sum, balance) => sum + balance.balanceCents, 0)).toBe(0);
  });

  it("starts everyone at zero", () => {
    expect(calculateBalances(household.members, []).map((balance) => balance.balanceCents)).toEqual([0, 0, 0]);
  });
});
