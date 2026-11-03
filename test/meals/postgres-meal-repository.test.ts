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

  it("stores recipes and one dinner per day, and keeps the dinner when its recipe goes", async () => {
    const household = createHousehold("Langstrasse 12", "Mia").household;
    await households.save(household);
    const [mia] = household.members;
    const pasta = createRecipe({ title: "Pasta", servings: 4, ingredientLines: ["500 g pasta", "Salt"] });

    await meals.addRecipe(household.id, pasta);
    await meals.saveMeal(household.id, { date: "2026-11-04", title: "Curry", recipeId: null, cookMemberId: null });
    await meals.saveMeal(household.id, { date: "2026-11-04", title: "Pasta", recipeId: pasta.id, cookMemberId: mia.id });
    await meals.saveMeal(household.id, { date: "2026-11-10", title: "Soup", recipeId: null, cookMemberId: null });

    expect(await meals.listRecipes(household.id)).toEqual([pasta]);
    expect(await meals.listMeals(household.id, "2026-11-02", "2026-11-08")).toEqual([
      { date: "2026-11-04", title: "Pasta", recipeId: pasta.id, cookMemberId: mia.id },
    ]);

    expect(await meals.removeRecipe(household.id, pasta.id)).toBe(true);
    expect((await meals.listMeals(household.id, "2026-11-04", "2026-11-04"))[0].recipeId).toBeNull();
    await meals.removeMeal(household.id, "2026-11-04");
    expect(await meals.listMeals(household.id, "2026-11-02", "2026-11-08")).toEqual([]);
  });
});
