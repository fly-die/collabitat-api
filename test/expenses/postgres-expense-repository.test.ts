import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectDatabase } from "../../src/db/database.js";
import { createExpense } from "../../src/expenses/expense.js";
import { PostgresExpenseRepository } from "../../src/expenses/postgres-expense-repository.js";
import { addMember, createHousehold } from "../../src/households/household.js";
import { PostgresHouseholdRepository } from "../../src/households/postgres-household-repository.js";

const databaseUrl = process.env.TEST_DATABASE_URL;

describe.runIf(databaseUrl)("Postgres expense repository", () => {
  let connection: Awaited<ReturnType<typeof connectDatabase>>;
  let households: PostgresHouseholdRepository;
  let expenses: PostgresExpenseRepository;

  beforeAll(async () => {
    connection = await connectDatabase(databaseUrl as string);
    households = new PostgresHouseholdRepository(connection.database);
    expenses = new PostgresExpenseRepository(connection.database);
  });

  afterAll(() => connection.close());

  async function savedHouseholdWithThreeMembers() {
    let household = createHousehold("Langstrasse 12", "Mia").household;
    await households.save(household);
    // Saved one by one, so the stored member order is unambiguous.
    for (const name of ["Lea", "Noah"]) {
      household = addMember(household, name);
      await households.save(household);
    }
    return household;
  }

  it("stores expenses with their shares, newest first, and removes them", async () => {
    const household = await savedHouseholdWithThreeMembers();
    const everyone = household.members.map((member) => member.id);
    const newExpense = {
      paidByMemberId: everyone[0],
      splitBetweenMemberIds: everyone,
    };
    const rent = createExpense(household, { ...newExpense, description: "Rent", amountCents: 1000, spentOn: "2026-10-01" });
    const groceries = createExpense(household, { ...newExpense, description: "Groceries", amountCents: 4550, spentOn: "2026-10-30" });
    await expenses.add(household.id, rent);
    await expenses.add(household.id, groceries);

    expect(await expenses.listByHousehold(household.id)).toEqual([groceries, rent]);

    expect(await expenses.remove(household.id, rent.id)).toBe(true);
    expect(await expenses.remove(household.id, rent.id)).toBe(false);
    expect(await expenses.listByHousehold(household.id)).toEqual([groceries]);
  });

  it("only removes an expense from its own household", async () => {
    const household = await savedHouseholdWithThreeMembers();
    const other = await savedHouseholdWithThreeMembers();
    const expense = createExpense(household, {
      description: "Groceries",
      amountCents: 1200,
      paidByMemberId: household.members[0].id,
      splitBetweenMemberIds: [household.members[0].id],
      spentOn: "2026-10-30",
    });
    await expenses.add(household.id, expense);

    expect(await expenses.remove(other.id, expense.id)).toBe(false);
    expect(await expenses.listByHousehold(household.id)).toEqual([expense]);
  });
});
