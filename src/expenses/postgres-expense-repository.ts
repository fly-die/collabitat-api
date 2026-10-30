import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { Database } from "../db/database.js";
import { expenseShares, expenses, members } from "../db/schema.js";
import type { Expense } from "./expense.js";
import type { ExpenseRepository } from "./expense-repository.js";

export class PostgresExpenseRepository implements ExpenseRepository {
  constructor(private readonly database: Database) {}

  async listByHousehold(householdId: string): Promise<Expense[]> {
    const rows = await this.database
      .select({
        id: expenses.id,
        description: expenses.description,
        amountCents: expenses.amountCents,
        paidByMemberId: expenses.paidByMemberId,
        spentOn: expenses.spentOn,
      })
      .from(expenses)
      .where(eq(expenses.householdId, householdId))
      .orderBy(desc(expenses.spentOn), desc(expenses.createdAt));
    if (rows.length === 0) {
      return [];
    }

    // Shares come back in household order, the same order the split was made in.
    const shares = await this.database
      .select({
        expenseId: expenseShares.expenseId,
        memberId: expenseShares.memberId,
        amountCents: expenseShares.amountCents,
      })
      .from(expenseShares)
      .innerJoin(members, eq(members.id, expenseShares.memberId))
      .where(
        inArray(
          expenseShares.expenseId,
          rows.map((row) => row.id),
        ),
      )
      .orderBy(asc(members.createdAt), asc(members.id));
    return rows.map((row) => ({
      ...row,
      shares: shares
        .filter((share) => share.expenseId === row.id)
        .map(({ memberId, amountCents }) => ({ memberId, amountCents })),
    }));
  }

  async add(householdId: string, expense: Expense) {
    await this.database.transaction(async (transaction) => {
      const { shares, ...columns } = expense;
      await transaction.insert(expenses).values({ ...columns, householdId });
      await transaction
        .insert(expenseShares)
        .values(shares.map((share) => ({ ...share, expenseId: expense.id })));
    });
  }

  async remove(householdId: string, expenseId: string) {
    const removed = await this.database
      .delete(expenses)
      .where(and(eq(expenses.id, expenseId), eq(expenses.householdId, householdId)))
      .returning({ id: expenses.id });
    return removed.length > 0;
  }
}
