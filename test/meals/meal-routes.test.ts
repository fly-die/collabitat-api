import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { HttpStatus } from "../../src/http-status.js";
import { MealErrorCode } from "../../src/meals/meal-plan.js";
import { newCredentials } from "../support/credentials.js";

type App = ReturnType<typeof buildApp>;
const WEEK = "from=2026-11-02";
const authorized = (token: string) => ({ authorization: `Bearer ${token}` });

async function household(app: App, name: string) {
  const created = await app.inject({ method: "POST", url: "/households", payload: { name, memberName: "Mia", ...newCredentials(name) } });
  return (created.json() as { token: string }).token;
}

describe("meal routes", () => {
  let app: App;
  let token: string;

  beforeEach(async () => {
    app = buildApp();
    token = await household(app, "langstrasse");
  });

  afterEach(() => app.close());

  const call = (method: "GET" | "PUT" | "POST" | "DELETE", url: string, payload?: object, as = token) =>
    app.inject({ method, url, headers: authorized(as), payload });

  it("plans a week of dinners from saved recipes, and clears a day", async () => {
    const added = await call("POST", `/household/recipes?${WEEK}`, { title: "Pasta", servings: 4, ingredientLines: ["500 g pasta"] });
    expect(added.statusCode).toBe(HttpStatus.Created);
    const [pasta] = added.json().recipes;

    await call("PUT", `/household/meals/2026-11-04?${WEEK}`, { recipeId: pasta.id });
    await call("PUT", `/household/meals/2026-11-02?${WEEK}`, { title: "Leftovers" });
    const outsideWeek = await call("PUT", `/household/meals/2026-11-09?${WEEK}`, { title: "Curry" });

    expect(outsideWeek.json().meals.map((meal: { date: string; title: string }) => [meal.date, meal.title])).toEqual([
      ["2026-11-02", "Leftovers"],
      ["2026-11-04", "Pasta"],
    ]);

    const cleared = await call("DELETE", `/household/meals/2026-11-02?${WEEK}`);
    expect(cleared.json().meals).toHaveLength(1);
  });

  it("keeps a dinner's name when its recipe is deleted", async () => {
    const [pasta] = (await call("POST", `/household/recipes?${WEEK}`, { title: "Pasta", servings: 4, ingredientLines: [] })).json().recipes;
    await call("PUT", `/household/meals/2026-11-04?${WEEK}`, { recipeId: pasta.id });

    const deleted = await call("DELETE", `/household/recipes/${pasta.id}?${WEEK}`);

    expect(deleted.json()).toEqual(
      expect.objectContaining({ recipes: [], meals: [expect.objectContaining({ title: "Pasta", recipeId: null })] }),
    );
    expect((await call("DELETE", `/household/recipes/${pasta.id}?${WEEK}`)).json().error).toBe(MealErrorCode.RecipeNotFound);
  });

  it("changes a recipe, renames the dinners planned with it, and refuses a recipe that is gone", async () => {
    const [pasta] = (await call("POST", `/household/recipes?${WEEK}`, { title: "Pasta", servings: 4, ingredientLines: ["500 g pasta"] })).json().recipes;
    await call("PUT", `/household/meals/2026-11-04?${WEEK}`, { recipeId: pasta.id });
    await call("PUT", `/household/meals/2026-11-05?${WEEK}`, { title: "Pasta" });

    const changed = await call("PUT", `/household/recipes/${pasta.id}?${WEEK}`, {
      title: "Pasta al pomodoro",
      servings: 2,
      ingredientLines: ["250 g pasta", "1 Dose Tomaten"],
    });

    expect(changed.json().recipes).toEqual([
      { ...pasta, title: "Pasta al pomodoro", servings: 2, ingredients: [
        { quantity: 250, unit: "g", name: "pasta" },
        { quantity: 1, unit: "dose", name: "Tomaten" },
      ] },
    ]);
    expect(changed.json().meals.map((meal: { title: string; recipeId: string | null }) => [meal.title, meal.recipeId])).toEqual([
      ["Pasta al pomodoro", pasta.id],
      ["Pasta", null],
    ]);
    const shopping = (await call("GET", `/household/shopping-list?${WEEK}`)).json();
    expect(shopping.items.map((item: { name: string; quantity: number }) => [item.name, item.quantity])).toContainEqual(["pasta", 250]);

    await call("DELETE", `/household/recipes/${pasta.id}?${WEEK}`);
    const gone = await call("PUT", `/household/recipes/${pasta.id}?${WEEK}`, { title: "Pasta", servings: 4, ingredientLines: [] });
    expect(gone.json().error).toBe(MealErrorCode.RecipeNotFound);
  });

  it("keeps each household's meals to itself", async () => {
    const [pasta] = (await call("POST", `/household/recipes?${WEEK}`, { title: "Pasta", servings: 4, ingredientLines: [] })).json().recipes;
    const other = await household(app, "seefeld");

    const borrowed = await call("PUT", `/household/meals/2026-11-04?${WEEK}`, { recipeId: pasta.id }, other);

    expect(borrowed.json().error).toBe(MealErrorCode.UnknownRecipe);
    expect((await call("GET", `/household/meals?${WEEK}`, undefined, other)).json()).toEqual({ from: "2026-11-02", meals: [], recipes: [] });
  });

  it("needs a valid week start", async () => {
    expect((await call("GET", "/household/meals?from=soon")).json().error).toBe(MealErrorCode.InvalidDate);
  });
});
