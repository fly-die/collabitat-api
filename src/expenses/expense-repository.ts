import type { Expense } from "./expense.js";

export interface ExpenseRepository {
  // Newest first: latest day first, and on the same day the one added last.
  listByHousehold(householdId: string): Promise<Expense[]>;
  add(householdId: string, expense: Expense): Promise<void>;
  // Returns false when the household has no expense with this id.
  remove(householdId: string, expenseId: string): Promise<boolean>;
}

export class InMemoryExpenseRepository implements ExpenseRepository {
  private readonly expensesByHouseholdId = new Map<string, Expense[]>();

  async listByHousehold(householdId: string) {
    const addedLastFirst = [...(this.expensesByHouseholdId.get(householdId) ?? [])].reverse();
    return addedLastFirst.sort((first, second) => second.spentOn.localeCompare(first.spentOn));
  }

  async add(householdId: string, expense: Expense) {
    this.expensesByHouseholdId.set(householdId, [
      ...(this.expensesByHouseholdId.get(householdId) ?? []),
      expense,
    ]);
  }

  async remove(householdId: string, expenseId: string) {
    const expenses = this.expensesByHouseholdId.get(householdId) ?? [];
    const remaining = expenses.filter((expense) => expense.id !== expenseId);
    this.expensesByHouseholdId.set(householdId, remaining);
    return remaining.length !== expenses.length;
  }
}
