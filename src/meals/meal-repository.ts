import type { PlannedMeal, Recipe } from "./meal-plan.js";

export interface MealRepository {
  listRecipes(householdId: string): Promise<Recipe[]>;
  addRecipe(householdId: string, recipe: Recipe): Promise<void>;
  // Returns false when the household has no recipe with this id. Planned dinners keep their title.
  removeRecipe(householdId: string, recipeId: string): Promise<boolean>;
  // Dinners from `from` up to and including `to`, earliest first.
  listMeals(householdId: string, from: string, to: string): Promise<PlannedMeal[]>;
  // Replaces whatever was planned that day.
  saveMeal(householdId: string, meal: PlannedMeal): Promise<void>;
  removeMeal(householdId: string, date: string): Promise<void>;
}

export class InMemoryMealRepository implements MealRepository {
  private readonly recipesByHouseholdId = new Map<string, Recipe[]>();
  private readonly mealsByHouseholdId = new Map<string, Map<string, PlannedMeal>>();

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

  async removeRecipe(householdId: string, recipeId: string) {
    const recipes = this.recipesByHouseholdId.get(householdId) ?? [];
    const remaining = recipes.filter((recipe) => recipe.id !== recipeId);
    this.recipesByHouseholdId.set(householdId, remaining);
    for (const [date, meal] of this.meals(householdId)) {
      if (meal.recipeId === recipeId) {
        this.meals(householdId).set(date, { ...meal, recipeId: null });
      }
    }
    return remaining.length !== recipes.length;
  }

  async listMeals(householdId: string, from: string, to: string) {
    return [...this.meals(householdId).values()]
      .filter((meal) => meal.date >= from && meal.date <= to)
      .sort((first, second) => first.date.localeCompare(second.date));
  }

  async saveMeal(householdId: string, meal: PlannedMeal) {
    this.meals(householdId).set(meal.date, meal);
  }

  async removeMeal(householdId: string, date: string) {
    this.meals(householdId).delete(date);
  }
}
