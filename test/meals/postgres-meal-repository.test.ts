import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectDatabase } from "../../src/db/database.js";
import { createHousehold } from "../../src/households/household.js";
import { PostgresHouseholdRepository } from "../../src/households/postgres-household-repository.js";
import { createRecipe } from "../../src/meals/meal-plan.js";
import { PostgresMealRepository } from "../../src/meals/postgres-meal-repository.js";

const databaseUrl = process.env.TEST_DATABASE_URL;

describe.runIf(databaseUrl)("Postgres meal repository", () => {
  let connection: Awaited<ReturnType<typeof connectDatabase>>;
  let households: PostgresHouseholdRepository;
  let meals: PostgresMealRepository;

  beforeAll(async () => {
    connection = await connectDatabase(databaseUrl as string);
    households = new PostgresHouseholdRepository(connection.database);
    meals = new PostgresMealRepository(connection.database);
  });

  afterAll(() => connection.close());

  it("stores recipes and one dinner per day with how many eat, and keeps the dinner when its recipe goes", async () => {
    const household = createHousehold("Langstrasse 12", "Mia").household;
    await households.save(household);
    const [mia] = household.members;
    const pasta = createRecipe({ title: "Pasta", servings: 4, ingredientLines: ["500 g pasta", "Salt"] });

    await meals.addRecipe(household.id, pasta);
    await meals.saveMeal(household.id, { date: "2026-11-04", slot: "dinner", title: "Curry", recipeId: null, cookMemberId: null, servings: null });
    await meals.saveMeal(household.id, { date: "2026-11-04", slot: "dinner", title: "Pasta", recipeId: pasta.id, cookMemberId: mia.id, servings: 6 });
    await meals.saveMeal(household.id, { date: "2026-11-10", slot: "dinner", title: "Soup", recipeId: null, cookMemberId: null, servings: null });

    expect(await meals.listRecipes(household.id)).toEqual([pasta]);
    expect(await meals.listMeals(household.id, "2026-11-02", "2026-11-08")).toEqual([
      { date: "2026-11-04", slot: "dinner", title: "Pasta", recipeId: pasta.id, cookMemberId: mia.id, servings: 6 },
    ]);

    expect(await meals.removeRecipe(household.id, pasta.id)).toBe(true);
    expect((await meals.listMeals(household.id, "2026-11-04", "2026-11-04"))[0].recipeId).toBeNull();
    await meals.removeMeal(household.id, "2026-11-04", "dinner");
    expect(await meals.listMeals(household.id, "2026-11-02", "2026-11-08")).toEqual([]);
  });

  it("keeps breakfast, lunch and dinner of one day apart, and the weekdays they are planned on", async () => {
    const household = createHousehold("Kreis 4", "Noah").household;
    await households.save(household);
    const meal = (slot: "breakfast" | "lunch" | "dinner", title: string) => ({ date: "2026-11-08", slot, title, recipeId: null, cookMemberId: null, servings: null });
    await meals.saveMeal(household.id, meal("dinner", "Raclette"));
    await meals.saveMeal(household.id, meal("breakfast", "Zopf"));
    await meals.saveMeal(household.id, meal("lunch", "Salad"));
    await meals.saveMeal(household.id, meal("lunch", "Soup"));
    await meals.removeMeal(household.id, "2026-11-08", "breakfast");
    await meals.saveMealTimes(household.id, { breakfast: [7], lunch: [6, 7] });

    expect((await meals.listMeals(household.id, "2026-11-08", "2026-11-08")).map(({ slot, title }) => [slot, title])).toEqual([
      ["lunch", "Soup"],
      ["dinner", "Raclette"],
    ]);
    expect(await meals.getMealTimes(household.id)).toEqual({ breakfast: [7], lunch: [6, 7] });
    await meals.saveMealTimes(household.id, { breakfast: [], lunch: [] });
    expect(await meals.getMealTimes(household.id)).toEqual({ breakfast: [], lunch: [] });
  });

  it("changes a recipe and renames only the dinners planned with it", async () => {
    const household = createHousehold("Seefeld 3", "Lea").household;
    await households.save(household);
    const pasta = createRecipe({ title: "Pasta", servings: 4, ingredientLines: ["500 g pasta"] });
    await meals.addRecipe(household.id, pasta);
    await meals.saveMeal(household.id, { date: "2026-11-04", slot: "dinner", title: "Pasta", recipeId: pasta.id, cookMemberId: null, servings: null });
    await meals.saveMeal(household.id, { date: "2026-11-05", slot: "dinner", title: "Pasta", recipeId: null, cookMemberId: null, servings: null });
    const changed = createRecipe({ title: "Penne", servings: 2, ingredientLines: ["250 g penne"] }, pasta);

    expect(await meals.updateRecipe(household.id, changed)).toBe(true);
    expect(await meals.listRecipes(household.id)).toEqual([changed]);
    expect((await meals.listMeals(household.id, "2026-11-04", "2026-11-05")).map((meal) => meal.title)).toEqual(["Penne", "Pasta"]);
    expect(await meals.updateRecipe(household.id, { ...changed, id: crypto.randomUUID() })).toBe(false);
  });
});
