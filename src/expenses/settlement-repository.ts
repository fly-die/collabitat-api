import type { Settlement } from "./expense.js";

export interface SettlementRepository {
  // Newest first: latest day first, and on the same day the one added last.
  listByHousehold(householdId: string): Promise<Settlement[]>;
  add(householdId: string, settlement: Settlement): Promise<void>;
  // Returns false when the household has no payment with this id.
  remove(householdId: string, settlementId: string): Promise<boolean>;
}

export class InMemorySettlementRepository implements SettlementRepository {
  private readonly settlementsByHouseholdId = new Map<string, Settlement[]>();

  async listByHousehold(householdId: string) {
    const addedLastFirst = [...(this.settlementsByHouseholdId.get(householdId) ?? [])].reverse();
    return addedLastFirst.sort((first, second) => second.settledOn.localeCompare(first.settledOn));
  }

  async add(householdId: string, settlement: Settlement) {
    this.settlementsByHouseholdId.set(householdId, [
      ...(this.settlementsByHouseholdId.get(householdId) ?? []),
      settlement,
    ]);
  }

  async remove(householdId: string, settlementId: string) {
    const settlements = this.settlementsByHouseholdId.get(householdId) ?? [];
    const remaining = settlements.filter((settlement) => settlement.id !== settlementId);
    this.settlementsByHouseholdId.set(householdId, remaining);
    return remaining.length !== settlements.length;
  }
}
