import type { MealSlot, MealTimes, PlannedMeal, Recipe } from "./meal-plan.js";

export interface MealRepository {
  listRecipes(householdId: string): Promise<Recipe[]>;
  addRecipe(householdId: string, recipe: Recipe): Promise<void>;
  // Dinners planned with it take its new name. Returns false when the household has no such recipe.
  updateRecipe(householdId: string, recipe: Recipe): Promise<boolean>;
  // Returns false when the household has no recipe with this id. Planned dinners keep their title.
  removeRecipe(householdId: string, recipeId: string): Promise<boolean>;
  // Meals from `from` up to and including `to`, earliest first, breakfast before lunch before dinner.
  listMeals(householdId: string, from: string, to: string): Promise<PlannedMeal[]>;
  // Replaces whatever was planned for that meal of that day.
  saveMeal(householdId: string, meal: PlannedMeal): Promise<void>;
  removeMeal(householdId: string, date: string, slot: MealSlot): Promise<void>;
  getMealTimes(householdId: string): Promise<MealTimes>;
  saveMealTimes(householdId: string, times: MealTimes): Promise<void>;
}

const SLOT_ORDER: MealSlot[] = ["breakfast", "lunch", "dinner"];
export const byDayThenSlot = (first: PlannedMeal, second: PlannedMeal) =>
  first.date.localeCompare(second.date) || SLOT_ORDER.indexOf(first.slot) - SLOT_ORDER.indexOf(second.slot);
const mealKey = (date: string, slot: MealSlot) => `${date}|${slot}`;

export class InMemoryMealRepository implements MealRepository {
  private readonly recipesByHouseholdId = new Map<string, Recipe[]>();
  private readonly mealsByHouseholdId = new Map<string, Map<string, PlannedMeal>>();
  private readonly mealTimesByHouseholdId = new Map<string, MealTimes>();

  private meals(householdId: string) {
    const meals = this.mealsByHouseholdId.get(householdId) ?? new Map<string, PlannedMeal>();
    this.mealsByHouseholdId.set(householdId, meals);
    return meals;
  }

  async listRecipes(householdId: string) {
    return [...(this.recipesByHouseholdId.get(householdId) ?? [])].sort((first, second) => first.title.localeCompare(second.title));
  }

  async addRecipe(householdId: string, recipe: Recipe) {
    this.recipesByHouseholdId.set(householdId, [...(this.recipesByHouseholdId.get(householdId) ?? []), recipe]);
  }

  async updateRecipe(householdId: string, recipe: Recipe) {
    const recipes = this.recipesByHouseholdId.get(householdId) ?? [];
    if (!recipes.some((candidate) => candidate.id === recipe.id)) {
      return false;
    }
    this.recipesByHouseholdId.set(householdId, recipes.map((candidate) => (candidate.id === recipe.id ? recipe : candidate)));
    for (const [key, meal] of this.meals(householdId)) {
      if (meal.recipeId === recipe.id) {
        this.meals(householdId).set(key, { ...meal, title: recipe.title });
      }
    }
    return true;
  }

  async removeRecipe(householdId: string, recipeId: string) {
    const recipes = this.recipesByHouseholdId.get(householdId) ?? [];
    const remaining = recipes.filter((recipe) => recipe.id !== recipeId);
    this.recipesByHouseholdId.set(householdId, remaining);
    for (const [key, meal] of this.meals(householdId)) {
      if (meal.recipeId === recipeId) {
        this.meals(householdId).set(key, { ...meal, recipeId: null });
      }
    }
    return remaining.length !== recipes.length;
  }

  async listMeals(householdId: string, from: string, to: string) {
    return [...this.meals(householdId).values()].filter((meal) => meal.date >= from && meal.date <= to).sort(byDayThenSlot);
  }

  async saveMeal(householdId: string, meal: PlannedMeal) {
    this.meals(householdId).set(mealKey(meal.date, meal.slot), meal);
  }

  async removeMeal(householdId: string, date: string, slot: MealSlot) {
    this.meals(householdId).delete(mealKey(date, slot));
  }

  async getMealTimes(householdId: string) {
    return this.mealTimesByHouseholdId.get(householdId) ?? { breakfast: [], lunch: [] };
  }

  async saveMealTimes(householdId: string, times: MealTimes) {
    this.mealTimesByHouseholdId.set(householdId, times);
  }
}
