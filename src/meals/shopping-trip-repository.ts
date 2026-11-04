import { and, eq } from "drizzle-orm";
import type { Database } from "../db/database.js";
import { shoppingChecks, shoppingTrips } from "../db/schema.js";

export interface ShoppingTrip {
  shopperMemberId: string;
  // The Monday of the week whose list is being shopped.
  from: string;
  startedAt: string;
}

// Who is at the shop right now, and which items are ticked on each week's list.
export interface ShoppingTripRepository {
  find(householdId: string): Promise<ShoppingTrip | undefined>;
  // Keeps a trip that is already going, so two flatmates starting at once shop one list.
  start(householdId: string, trip: ShoppingTrip): Promise<void>;
  end(householdId: string): Promise<void>;
  listChecked(householdId: string, from: string): Promise<string[]>;
  setChecked(householdId: string, from: string, itemKey: string, checked: boolean): Promise<void>;
}

const checkId = (from: string, itemKey: string) => `${from}|${itemKey}`;

export class InMemoryShoppingTripRepository implements ShoppingTripRepository {
  private readonly tripsByHouseholdId = new Map<string, ShoppingTrip>();
  private readonly checksByHouseholdId = new Map<string, Set<string>>();

  async find(householdId: string) {
    return this.tripsByHouseholdId.get(householdId);
  }

  async start(householdId: string, trip: ShoppingTrip) {
    if (!this.tripsByHouseholdId.has(householdId)) {
      this.tripsByHouseholdId.set(householdId, trip);
    }
  }

  async end(householdId: string) {
    this.tripsByHouseholdId.delete(householdId);
  }

  async listChecked(householdId: string, from: string) {
    const prefix = checkId(from, "");
    return [...(this.checksByHouseholdId.get(householdId) ?? [])]
      .filter((id) => id.startsWith(prefix))
      .map((id) => id.slice(prefix.length));
  }

  async setChecked(householdId: string, from: string, itemKey: string, checked: boolean) {
    const checks = this.checksByHouseholdId.get(householdId) ?? new Set<string>();
    if (checked) {
      checks.add(checkId(from, itemKey));
    } else {
      checks.delete(checkId(from, itemKey));
    }
    this.checksByHouseholdId.set(householdId, checks);
  }
}

export class PostgresShoppingTripRepository implements ShoppingTripRepository {
  constructor(private readonly database: Database) {}

  async find(householdId: string) {
    const [row] = await this.database.select().from(shoppingTrips).where(eq(shoppingTrips.householdId, householdId));
    return row && { shopperMemberId: row.shopperMemberId, from: row.weekFrom, startedAt: row.startedAt.toISOString() };
  }

  async start(householdId: string, trip: ShoppingTrip) {
    await this.database
      .insert(shoppingTrips)
      .values({ householdId, shopperMemberId: trip.shopperMemberId, weekFrom: trip.from, startedAt: new Date(trip.startedAt) })
      .onConflictDoNothing();
  }

  async end(householdId: string) {
    await this.database.delete(shoppingTrips).where(eq(shoppingTrips.householdId, householdId));
  }

  async listChecked(householdId: string, from: string) {
    const rows = await this.database
      .select({ itemKey: shoppingChecks.itemKey })
      .from(shoppingChecks)
      .where(and(eq(shoppingChecks.householdId, householdId), eq(shoppingChecks.weekFrom, from)));
    return rows.map((row) => row.itemKey);
  }

  async setChecked(householdId: string, from: string, itemKey: string, checked: boolean) {
    if (checked) {
      await this.database.insert(shoppingChecks).values({ householdId, weekFrom: from, itemKey }).onConflictDoNothing();
      return;
    }
    await this.database
      .delete(shoppingChecks)
      .where(and(eq(shoppingChecks.householdId, householdId), eq(shoppingChecks.weekFrom, from), eq(shoppingChecks.itemKey, itemKey)));
  }
}
