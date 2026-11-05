import { and, asc, eq, gte, lte } from "drizzle-orm";
import type { Database } from "../db/database.js";
import { mealTimes, plannedMeals, recipes } from "../db/schema.js";
import type { MealSlot, MealTimes, PlannedMeal, Recipe } from "./meal-plan.js";
import { byDayThenSlot, type MealRepository } from "./meal-repository.js";

export class PostgresMealRepository implements MealRepository {
  constructor(private readonly database: Database) {}

  async listRecipes(householdId: string) {
    const rows = await this.database.select().from(recipes).where(eq(recipes.householdId, householdId)).orderBy(asc(recipes.title));
    return rows.map(({ id, title, servings, ingredients, createdAt }) => ({ id, title, servings, ingredients, createdAt: createdAt.toISOString() }));
  }

  async addRecipe(householdId: string, recipe: Recipe) {
    await this.database.insert(recipes).values({ ...recipe, householdId, createdAt: new Date(recipe.createdAt) });
  }

  async updateRecipe(householdId: string, recipe: Recipe) {
    return this.database.transaction(async (transaction) => {
      const updated = await transaction
        .update(recipes)
        .set({ title: recipe.title, servings: recipe.servings, ingredients: recipe.ingredients })
        .where(and(eq(recipes.id, recipe.id), eq(recipes.householdId, householdId)))
        .returning({ id: recipes.id });
      if (updated.length === 0) {
        return false;
      }
      await transaction
        .update(plannedMeals)
        .set({ title: recipe.title })
        .where(and(eq(plannedMeals.householdId, householdId), eq(plannedMeals.recipeId, recipe.id)));
      return true;
    });
  }

  async removeRecipe(householdId: string, recipeId: string) {
    const removed = await this.database
      .delete(recipes)
      .where(and(eq(recipes.id, recipeId), eq(recipes.householdId, householdId)))
      .returning({ id: recipes.id });
    return removed.length > 0;
  }

  async listMeals(householdId: string, from: string, to: string) {
    const rows = await this.database
      .select({
        date: plannedMeals.date,
        slot: plannedMeals.slot,
        title: plannedMeals.title,
        recipeId: plannedMeals.recipeId,
        cookMemberId: plannedMeals.cookMemberId,
      })
      .from(plannedMeals)
      .where(and(eq(plannedMeals.householdId, householdId), gte(plannedMeals.date, from), lte(plannedMeals.date, to)));
    return rows.map((row) => ({ ...row, slot: row.slot as MealSlot })).sort(byDayThenSlot);
  }

  async saveMeal(householdId: string, meal: PlannedMeal) {
    const { title, recipeId, cookMemberId } = meal;
    await this.database
      .insert(plannedMeals)
      .values({ ...meal, householdId })
      .onConflictDoUpdate({ target: [plannedMeals.householdId, plannedMeals.date, plannedMeals.slot], set: { title, recipeId, cookMemberId } });
  }

  async removeMeal(householdId: string, date: string, slot: MealSlot) {
    await this.database
      .delete(plannedMeals)
      .where(and(eq(plannedMeals.householdId, householdId), eq(plannedMeals.date, date), eq(plannedMeals.slot, slot)));
  }

  async getMealTimes(householdId: string) {
    const rows = await this.database.select().from(mealTimes).where(eq(mealTimes.householdId, householdId)).orderBy(asc(mealTimes.weekday));
    const weekdaysFor = (slot: MealSlot) => rows.filter((row) => row.slot === slot).map((row) => row.weekday);
    return { breakfast: weekdaysFor("breakfast"), lunch: weekdaysFor("lunch") };
  }

  async saveMealTimes(householdId: string, times: MealTimes) {
    await this.database.transaction(async (transaction) => {
      await transaction.delete(mealTimes).where(eq(mealTimes.householdId, householdId));
      const rows = [
        ...times.breakfast.map((weekday) => ({ householdId, slot: "breakfast", weekday })),
        ...times.lunch.map((weekday) => ({ householdId, slot: "lunch", weekday })),
      ];
      if (rows.length > 0) {
        await transaction.insert(mealTimes).values(rows);
      }
    });
  }
}
