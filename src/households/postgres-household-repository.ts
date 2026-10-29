import { and, asc, eq, notInArray, sql } from "drizzle-orm";
import type { Database } from "../db/database.js";
import { households, members } from "../db/schema.js";
import type { Household } from "./household.js";
import type { HouseholdRepository } from "./household-repository.js";

const householdColumns = {
  id: households.id,
  name: households.name,
  inviteCode: households.inviteCode,
};

export class PostgresHouseholdRepository implements HouseholdRepository {
  constructor(private readonly database: Database) {}

  async findByInviteCode(inviteCode: string) {
    const [household] = await this.database
      .select(householdColumns)
      .from(households)
      .where(eq(households.inviteCode, inviteCode));
    return household ? this.withMembers(household) : undefined;
  }

  async findByMemberId(memberId: string) {
    const [household] = await this.database
      .select(householdColumns)
      .from(households)
      .innerJoin(members, eq(members.householdId, households.id))
      .where(eq(members.id, memberId));
    return household ? this.withMembers(household) : undefined;
  }

  private async withMembers(household: Omit<Household, "members">): Promise<Household> {
    const householdMembers = await this.database
      .select({ id: members.id, name: members.name, joinedAt: members.joinedAt })
      .from(members)
      .where(eq(members.householdId, household.id))
      .orderBy(asc(members.createdAt), asc(members.id));

    return {
      ...household,
      members: householdMembers.map(({ id, name, joinedAt }) => ({
        id,
        name,
        hasJoined: joinedAt !== null,
      })),
    };
  }

  async save(household: Household): Promise<void> {
    await this.database.transaction(async (transaction) => {
      await transaction
        .insert(households)
        .values({ id: household.id, name: household.name, inviteCode: household.inviteCode })
        .onConflictDoUpdate({
          target: households.id,
          set: { name: household.name, inviteCode: household.inviteCode },
        });

      const memberIds = household.members.map((member) => member.id);
      await transaction
        .delete(members)
        .where(
          memberIds.length > 0
            ? and(eq(members.householdId, household.id), notInArray(members.id, memberIds))
            : eq(members.householdId, household.id),
        );

      if (household.members.length > 0) {
        const now = new Date();
        await transaction
          .insert(members)
          .values(
            household.members.map((member) => ({
              id: member.id,
              name: member.name,
              householdId: household.id,
              joinedAt: member.hasJoined ? now : null,
            })),
          )
          .onConflictDoUpdate({
            target: members.id,
            // Keeps the first join time once a member has joined.
            set: { joinedAt: sql`coalesce(${members.joinedAt}, excluded.joined_at)` },
          });
      }
    });
  }
}
