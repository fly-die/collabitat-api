import { describe, expect, it } from "vitest";
import { ExpenseErrorCode } from "../../src/expenses/expense-errors.js";
import { calculateBalances, createExpense, type Balance } from "../../src/expenses/expense.js";
import { createSettlement, simplifyDebts, type NewSettlement } from "../../src/expenses/settlement.js";
import { addMember, createHousehold } from "../../src/households/household.js";

const balancesOf = (entries: [string, number][]): Balance[] =>
  entries.map(([memberId, balanceCents]) => ({ memberId, balanceCents }));

describe("settling up", () => {
  const withMembers = addMember(addMember(createHousehold("Langstrasse 12", "Mia").household, "Lea"), "Noah");
  const [mia, lea, noah] = withMembers.members;

  it("lets the biggest debtor pay the biggest creditor first", () => {
    const transfers = simplifyDebts(balancesOf([["mia", 2533], ["lea", -1017], ["noah", -1516]]));

    expect(transfers).toEqual([
      { fromMemberId: "noah", toMemberId: "mia", amountCents: 1516 },
      { fromMemberId: "lea", toMemberId: "mia", amountCents: 1017 },
    ]);
  });

  it("skips the middle person in a chain of debts", () => {
    // A owes B 10 and B owes C 10: one payment from A to C settles everything.
    expect(simplifyDebts(balancesOf([["a", -1000], ["b", 0], ["c", 1000]]))).toEqual([
      { fromMemberId: "a", toMemberId: "c", amountCents: 1000 },
    ]);
  });

  it("needs nothing when everyone is square", () => {
    expect(simplifyDebts(balancesOf([["a", 0], ["b", 0]]))).toEqual([]);
  });

  it.each([
    [[["a", 700], ["b", -200], ["c", -300], ["d", -200]]],
    [[["a", 1], ["b", 1], ["c", 1], ["d", -3]]],
    [[["a", 5050], ["b", -2525], ["c", 1234], ["d", -3759], ["e", 0], ["f", 0]]],
  ] as [string, number][][][])("settles %j completely in at most n - 1 payments", (entries) => {
    const transfers = simplifyDebts(balancesOf(entries));
    const settled = new Map(entries);
    for (const transfer of transfers) {
      settled.set(transfer.fromMemberId, (settled.get(transfer.fromMemberId) ?? 0) + transfer.amountCents);
      settled.set(transfer.toMemberId, (settled.get(transfer.toMemberId) ?? 0) - transfer.amountCents);
    }

    expect([...settled.values()].every((balanceCents) => balanceCents === 0)).toBe(true);
    expect(transfers.length).toBeLessThanOrEqual(entries.length - 1);
  });

  it("counts payments in the balances, so paying the suggested amounts squares everyone", () => {
    const groceries = createExpense(withMembers, {
      description: "Groceries",
      amountCents: 4550,
      paidByMemberId: mia.id,
      splitBetweenMemberIds: [mia.id, lea.id, noah.id],
      spentOn: "2026-10-30",
    });
    const owed = calculateBalances(withMembers.members, [groceries]);
    const payments = simplifyDebts(owed).map((transfer) =>
      createSettlement(withMembers, { ...transfer, settledOn: "2026-10-31" }),
    );

    expect(calculateBalances(withMembers.members, [groceries], payments).map((balance) => balance.balanceCents)).toEqual([0, 0, 0]);
  });

  it("rejects a payment to yourself or from a stranger", () => {
    const valid: NewSettlement = { fromMemberId: mia.id, toMemberId: lea.id, amountCents: 500, settledOn: "2026-10-31" };

    for (const overrides of [{ toMemberId: mia.id }, { fromMemberId: "someone-else" }]) {
      expect(() => createSettlement(withMembers, { ...valid, ...overrides })).toThrow(
        expect.objectContaining({ code: ExpenseErrorCode.InvalidSettlement }),
      );
    }
  });

  it("rejects an amount or date that makes no sense", () => {
    const valid = { fromMemberId: mia.id, toMemberId: lea.id, amountCents: 500, settledOn: "2026-10-31" };

    expect(() => createSettlement(withMembers, { ...valid, amountCents: 0 })).toThrow(
      expect.objectContaining({ code: ExpenseErrorCode.InvalidAmount }),
    );
    expect(() => createSettlement(withMembers, { ...valid, settledOn: "2026-13-01" })).toThrow(
      expect.objectContaining({ code: ExpenseErrorCode.InvalidDate }),
    );
  });
});
