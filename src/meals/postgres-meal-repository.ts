import { and, asc, eq, gte, lte } from "drizzle-orm";
import type { Database } from "../db/database.js";
import { plannedMeals, recipes } from "../db/schema.js";
import type { PlannedMeal, Recipe } from "./meal-plan.js";
import type { MealRepository } from "./meal-repository.js";

export class PostgresMealRepository implements MealRepository {
  constructor(private readonly database: Database) {}

  async listRecipes(householdId: string) {
    const rows = await this.database.select().from(recipes).where(eq(recipes.householdId, householdId)).orderBy(asc(recipes.title));
    return rows.map(({ id, title, servings, ingredients, createdAt }) => ({ id, title, servings, ingredients, createdAt: createdAt.toISOString() }));
  }

  async addRecipe(householdId: string, recipe: Recipe) {
    await this.database.insert(recipes).values({ ...recipe, householdId, createdAt: new Date(recipe.createdAt) });
  }

  async removeRecipe(householdId: string, recipeId: string) {
    const removed = await this.database
      .delete(recipes)
      .where(and(eq(recipes.id, recipeId), eq(recipes.householdId, householdId)))
      .returning({ id: recipes.id });
    return removed.length > 0;
  }

  async listMeals(householdId: string, from: string, to: string) {
    return this.database
      .select({ date: plannedMeals.date, title: plannedMeals.title, recipeId: plannedMeals.recipeId, cookMemberId: plannedMeals.cookMemberId })
      .from(plannedMeals)
      .where(and(eq(plannedMeals.householdId, householdId), gte(plannedMeals.date, from), lte(plannedMeals.date, to)))
      .orderBy(asc(plannedMeals.date));
  }

  async saveMeal(householdId: string, meal: PlannedMeal) {
    const { title, recipeId, cookMemberId } = meal;
    await this.database
      .insert(plannedMeals)
      .values({ ...meal, householdId })
      .onConflictDoUpdate({ target: [plannedMeals.householdId, plannedMeals.date], set: { title, recipeId, cookMemberId } });
  }

  async removeMeal(householdId: string, date: string) {
    await this.database.delete(plannedMeals).where(and(eq(plannedMeals.householdId, householdId), eq(plannedMeals.date, date)));
  }
}
