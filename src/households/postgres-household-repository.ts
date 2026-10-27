import { and, asc, eq, notInArray } from "drizzle-orm";
import type { Database } from "../db/database.js";
import { households, members } from "../db/schema.js";
import type { Household } from "./household.js";
import type { HouseholdRepository } from "./household-repository.js";

export class PostgresHouseholdRepository implements HouseholdRepository {
  constructor(private readonly database: Database) {}

  async findById(id: string): Promise<Household | undefined> {
    const [household] = await this.database
      .select({ id: households.id, name: households.name })
      .from(households)
      .where(eq(households.id, id));
    if (!household) {
      return undefined;
    }

    const householdMembers = await this.database
      .select({ id: members.id, name: members.name })
      .from(members)
      .where(eq(members.householdId, id))
      .orderBy(asc(members.createdAt), asc(members.id));

    return { ...household, members: householdMembers };
  }

  async save(household: Household): Promise<void> {
    await this.database.transaction(async (transaction) => {
      await transaction
        .insert(households)
        .values({ id: household.id, name: household.name })
        .onConflictDoUpdate({ target: households.id, set: { name: household.name } });

      const memberIds = household.members.map((member) => member.id);
      await transaction
        .delete(members)
        .where(
          memberIds.length > 0
            ? and(eq(members.householdId, household.id), notInArray(members.id, memberIds))
            : eq(members.householdId, household.id),
        );

      if (household.members.length > 0) {
        await transaction
          .insert(members)
          .values(household.members.map((member) => ({ ...member, householdId: household.id })))
          .onConflictDoNothing({ target: members.id });
      }
    });
  }
}
