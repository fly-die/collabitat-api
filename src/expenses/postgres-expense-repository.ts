import { and, asc, desc, eq, inArray, type SQL } from "drizzle-orm";
import type { Database } from "../db/database.js";
import { expenseShares, expenses, members } from "../db/schema.js";
import type { Expense } from "./expense.js";
import type { ExpenseRepository } from "./expense-repository.js";

export class PostgresExpenseRepository implements ExpenseRepository {
  constructor(private readonly database: Database) {}

  private async load(where: SQL | undefined): Promise<Expense[]> {
    const rows = await this.database
      .select({
        id: expenses.id,
        description: expenses.description,
        amountCents: expenses.amountCents,
        paidByMemberId: expenses.paidByMemberId,
        spentOn: expenses.spentOn,
        createdAt: expenses.createdAt,
      })
      .from(expenses)
      .where(where)
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
      createdAt: row.createdAt.toISOString(),
      shares: shares
        .filter((share) => share.expenseId === row.id)
        .map(({ memberId, amountCents }) => ({ memberId, amountCents })),
    }));
  }

  listByHousehold(householdId: string) {
    return this.load(eq(expenses.householdId, householdId));
  }

  async find(householdId: string, expenseId: string) {
    const [expense] = await this.load(and(eq(expenses.id, expenseId), eq(expenses.householdId, householdId)));
    return expense;
  }

  async add(householdId: string, expense: Expense) {
    await this.database.transaction(async (transaction) => {
      const { shares, createdAt, ...columns } = expense;
      await transaction.insert(expenses).values({ ...columns, householdId, createdAt: new Date(createdAt) });
      await transaction
        .insert(expenseShares)
        .values(shares.map((share) => ({ ...share, expenseId: expense.id })));
    });
  }

  async replace(householdId: string, expense: Expense) {
    return this.database.transaction(async (transaction) => {
      const { id, description, amountCents, paidByMemberId, spentOn, shares } = expense;
      const updated = await transaction
        .update(expenses)
        .set({ description, amountCents, paidByMemberId, spentOn })
        .where(and(eq(expenses.id, id), eq(expenses.householdId, householdId)))
        .returning({ id: expenses.id });
      if (updated.length === 0) {
        return false;
      }
      await transaction.delete(expenseShares).where(eq(expenseShares.expenseId, id));
      await transaction.insert(expenseShares).values(shares.map((share) => ({ ...share, expenseId: id })));
      return true;
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
