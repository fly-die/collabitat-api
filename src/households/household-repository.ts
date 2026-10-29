import type { Household } from "./household.js";

export interface HouseholdRepository {
  findByInviteCode(inviteCode: string): Promise<Household | undefined>;
  findByMemberId(memberId: string): Promise<Household | undefined>;
  save(household: Household): Promise<void>;
}

export class InMemoryHouseholdRepository implements HouseholdRepository {
  private readonly householdsById = new Map<string, Household>();

  async findByInviteCode(inviteCode: string) {
    return [...this.householdsById.values()].find(
      (household) => household.inviteCode === inviteCode,
    );
  }

  async findByMemberId(memberId: string) {
    return [...this.householdsById.values()].find((household) =>
      household.members.some((member) => member.id === memberId),
    );
  }

  async save(household: Household) {
    this.householdsById.set(household.id, household);
  }
}
