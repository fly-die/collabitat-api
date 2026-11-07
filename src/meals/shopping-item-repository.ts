import { asc, and, eq } from "drizzle-orm";
import type { Database } from "../db/database.js";
import { shoppingItems } from "../db/schema.js";
import type { ExtraItem } from "./shopping-list.js";

// Items added to the shopping list by hand.
export interface ShoppingItemRepository {
  list(householdId: string): Promise<ExtraItem[]>;
  add(householdId: string, item: ExtraItem): Promise<void>;
  // Returns false when the household has no item with this id.
  remove(householdId: string, itemId: string): Promise<boolean>;
}

export class InMemoryShoppingItemRepository implements ShoppingItemRepository {
  private readonly itemsByHouseholdId = new Map<string, ExtraItem[]>();

  async list(householdId: string) {
    return [...(this.itemsByHouseholdId.get(householdId) ?? [])];
  }

  async add(householdId: string, item: ExtraItem) {
    this.itemsByHouseholdId.set(householdId, [...(this.itemsByHouseholdId.get(householdId) ?? []), item]);
  }

  async remove(householdId: string, itemId: string) {
    const items = this.itemsByHouseholdId.get(householdId) ?? [];
    const remaining = items.filter((item) => item.id !== itemId);
    this.itemsByHouseholdId.set(householdId, remaining);
    return remaining.length !== items.length;
  }
}

export class PostgresShoppingItemRepository implements ShoppingItemRepository {
  constructor(private readonly database: Database) {}

  async list(householdId: string) {
    const rows = await this.database
      .select({ id: shoppingItems.id, line: shoppingItems.line, createdAt: shoppingItems.createdAt, recipeTitle: shoppingItems.recipeTitle })
      .from(shoppingItems)
      .where(eq(shoppingItems.householdId, householdId))
      .orderBy(asc(shoppingItems.createdAt));
    return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
  }

  async add(householdId: string, item: ExtraItem) {
    await this.database.insert(shoppingItems).values({ ...item, householdId, createdAt: new Date(item.createdAt) });
  }

  async remove(householdId: string, itemId: string) {
    const removed = await this.database
      .delete(shoppingItems)
      .where(and(eq(shoppingItems.id, itemId), eq(shoppingItems.householdId, householdId)))
      .returning({ id: shoppingItems.id });
    return removed.length > 0;
  }
}
