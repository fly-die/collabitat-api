import type { Expense } from "./expense.js";

export interface ExpenseRepository {
  // Newest first: latest day first, and on the same day the one added last.
  listByHousehold(householdId: string): Promise<Expense[]>;
  find(householdId: string, expenseId: string): Promise<Expense | undefined>;
  add(householdId: string, expense: Expense): Promise<void>;
  // Swaps in the edited expense with its new shares. Returns false when the household has no expense with this id.
  replace(householdId: string, expense: Expense): Promise<boolean>;
  // Returns false when the household has no expense with this id.
  remove(householdId: string, expenseId: string): Promise<boolean>;
}

export class InMemoryExpenseRepository implements ExpenseRepository {
  private readonly expensesByHouseholdId = new Map<string, Expense[]>();

  async listByHousehold(householdId: string) {
    const addedLastFirst = [...(this.expensesByHouseholdId.get(householdId) ?? [])].reverse();
    return addedLastFirst.sort((first, second) => second.spentOn.localeCompare(first.spentOn));
  }

  async find(householdId: string, expenseId: string) {
    return this.expensesByHouseholdId.get(householdId)?.find((expense) => expense.id === expenseId);
  }

  async add(householdId: string, expense: Expense) {
    this.expensesByHouseholdId.set(householdId, [
      ...(this.expensesByHouseholdId.get(householdId) ?? []),
      expense,
    ]);
  }

  async replace(householdId: string, edited: Expense) {
    const expenses = this.expensesByHouseholdId.get(householdId) ?? [];
    if (!expenses.some((expense) => expense.id === edited.id)) {
      return false;
    }
    this.expensesByHouseholdId.set(
      householdId,
      expenses.map((expense) => (expense.id === edited.id ? edited : expense)),
    );
    return true;
  }

  async remove(householdId: string, expenseId: string) {
    const expenses = this.expensesByHouseholdId.get(householdId) ?? [];
    const remaining = expenses.filter((expense) => expense.id !== expenseId);
    this.expensesByHouseholdId.set(householdId, remaining);
    return remaining.length !== expenses.length;
  }
}
