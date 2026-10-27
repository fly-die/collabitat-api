import type { Household } from "./household.js";

export interface HouseholdRepository {
  findById(id: string): Promise<Household | undefined>;
  save(household: Household): Promise<void>;
}

export class InMemoryHouseholdRepository implements HouseholdRepository {
  private readonly householdsById = new Map<string, Household>();

  async findById(id: string) {
    return this.householdsById.get(id);
  }

  async save(household: Household) {
    this.householdsById.set(household.id, household);
  }
}
