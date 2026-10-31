import { and, desc, eq } from "drizzle-orm";
import type { Database } from "../db/database.js";
import { settlements } from "../db/schema.js";
import type { Settlement } from "./expense.js";
import type { SettlementRepository } from "./settlement-repository.js";

export class PostgresSettlementRepository implements SettlementRepository {
  constructor(private readonly database: Database) {}

  async listByHousehold(householdId: string): Promise<Settlement[]> {
    return this.database
      .select({
        id: settlements.id,
        fromMemberId: settlements.fromMemberId,
        toMemberId: settlements.toMemberId,
        amountCents: settlements.amountCents,
        settledOn: settlements.settledOn,
      })
      .from(settlements)
      .where(eq(settlements.householdId, householdId))
      .orderBy(desc(settlements.settledOn), desc(settlements.createdAt));
  }

  async add(householdId: string, settlement: Settlement) {
    await this.database.insert(settlements).values({ ...settlement, householdId });
  }

  async remove(householdId: string, settlementId: string) {
    const removed = await this.database
      .delete(settlements)
      .where(and(eq(settlements.id, settlementId), eq(settlements.householdId, householdId)))
      .returning({ id: settlements.id });
    return removed.length > 0;
  }
}
