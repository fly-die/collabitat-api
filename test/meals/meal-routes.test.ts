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

  it("plans breakfast and lunch beside dinner on the weekdays the household picks", async () => {
    const [muesli] = (await call("POST", `/household/recipes?${WEEK}`, { title: "Birchermüesli", servings: 2, ingredientLines: ["200 g Haferflocken"] })).json().recipes;

    const times = await call("PUT", `/household/meal-times?${WEEK}`, { breakfast: [7, 6, 7], lunch: [] });
    await call("PUT", `/household/meals/2026-11-08?${WEEK}&slot=breakfast`, { recipeId: muesli.id });
    await call("PUT", `/household/meals/2026-11-08?${WEEK}`, { title: "Raclette" });
    const week = (await call("GET", `/household/meals?${WEEK}`)).json();

    expect(times.json().mealTimes).toEqual({ breakfast: [6, 7], lunch: [] });
    expect(week.meals.map(({ date, slot, title }: { date: string; slot: string; title: string }) => [date, slot, title])).toEqual([
      ["2026-11-08", "breakfast", "Birchermüesli"],
      ["2026-11-08", "dinner", "Raclette"],
    ]);
    const shopping = (await call("GET", `/household/shopping-list?${WEEK}`)).json();
    expect(shopping.items.map((item: { name: string }) => item.name)).toEqual(["Haferflocken"]);

    await call("DELETE", `/household/meals/2026-11-08?${WEEK}&slot=breakfast`);
    expect((await call("GET", `/household/meals?${WEEK}`)).json().meals.map((meal: { title: string }) => meal.title)).toEqual(["Raclette"]);
    const refused = await call("PUT", `/household/meal-times?${WEEK}`, { breakfast: [0], lunch: [] });
    expect(refused.json().error).toBe(MealErrorCode.InvalidMealTimes);
  });

  it("lists past meals once each, newest first, with when and how often", async () => {
    const [pasta] = (await call("POST", `/household/recipes?${WEEK}`, { title: "Pasta", servings: 4, ingredientLines: [] })).json().recipes;
    await call("PUT", `/household/meals/2026-10-20?${WEEK}`, { recipeId: pasta.id });
    await call("PUT", `/household/meals/2026-10-27?${WEEK}`, { title: "Curry" });
    await call("PUT", `/household/meals/2026-11-02?${WEEK}`, { title: "pasta" });
    await call("PUT", `/household/meals/2026-11-02?${WEEK}&slot=breakfast`, { title: "Zopf" });
    await call("PUT", `/household/meals/2026-11-04?${WEEK}`, { title: "Tonight's soup" });
    await call("PUT", `/household/meals/2025-10-01?${WEEK}`, { title: "Too long ago" });

    const history = await call("GET", "/household/meals/history?before=2026-11-04");

    expect(history.json().pastMeals).toEqual([
      { title: "pasta", recipeId: pasta.id, lastOn: "2026-11-02", times: 2 },
      { title: "Zopf", recipeId: null, lastOn: "2026-11-02", times: 1 },
      { title: "Curry", recipeId: null, lastOn: "2026-10-27", times: 1 },
    ]);
    expect((await call("GET", "/household/meals/history?before=nope")).json().error).toBe(MealErrorCode.InvalidDate);
  });

  it("keeps each household's meals to itself", async () => {
    const [pasta] = (await call("POST", `/household/recipes?${WEEK}`, { title: "Pasta", servings: 4, ingredientLines: [] })).json().recipes;
    const other = await household(app, "seefeld");

    const borrowed = await call("PUT", `/household/meals/2026-11-04?${WEEK}`, { recipeId: pasta.id }, other);

    expect(borrowed.json().error).toBe(MealErrorCode.UnknownRecipe);
    expect((await call("GET", `/household/meals?${WEEK}`, undefined, other)).json()).toEqual({ from: "2026-11-02", meals: [], recipes: [], mealTimes: { breakfast: [], lunch: [] } });
  });

  it("needs a valid week start", async () => {
    expect((await call("GET", "/household/meals?from=soon")).json().error).toBe(MealErrorCode.InvalidDate);
  });
});
