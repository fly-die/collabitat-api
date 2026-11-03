import { describe, expect, it } from "vitest";
import { addMember, createHousehold } from "../../src/households/household.js";
import { MealErrorCode, createRecipe, parseIngredient, planMeal } from "../../src/meals/meal-plan.js";

describe("meal plan", () => {
  it.each([
    ["500 g pasta", { quantity: 500, unit: "g", name: "pasta" }],
    ["1,5 dl Rahm", { quantity: 1.5, unit: "dl", name: "Rahm" }],
    ["1/2 TL Salz", { quantity: 0.5, unit: "tl", name: "Salz" }],
    ["2 onions", { quantity: 2, unit: null, name: "onions" }],
    ["2 Dosen Tomaten", { quantity: 2, unit: "dosen", name: "Tomaten" }],
    ["Salt", { quantity: null, unit: null, name: "Salt" }],
    ["g strings", { quantity: null, unit: null, name: "g strings" }],
    ["  3   cloves  garlic ", { quantity: 3, unit: null, name: "cloves garlic" }],
  ])("reads %j", (line, ingredient) => {
    expect(parseIngredient(line)).toEqual(ingredient);
  });

  it("saves a recipe with its ingredients, skipping empty lines", () => {
    const recipe = createRecipe({ title: " Pasta al pomodoro ", servings: 4, ingredientLines: ["500 g pasta", "", "Salt"] });

    expect(recipe).toEqual(
      expect.objectContaining({
        title: "Pasta al pomodoro",
        servings: 4,
        ingredients: [
          { quantity: 500, unit: "g", name: "pasta" },
          { quantity: null, unit: null, name: "Salt" },
        ],
      }),
    );
  });

  it.each([
    ["no title", { title: " " }, MealErrorCode.InvalidTitle],
    ["zero servings", { servings: 0 }, MealErrorCode.InvalidServings],
    ["too many ingredients", { ingredientLines: Array(61).fill("x") }, MealErrorCode.InvalidIngredients],
  ])("refuses a recipe with %s", (_label, overrides, code) => {
    expect(() => createRecipe({ title: "Pasta", servings: 4, ingredientLines: [], ...overrides })).toThrow(
      expect.objectContaining({ code }),
    );
  });

  it("names a dinner after its recipe, checks the cook and the date", () => {
    const household = addMember(createHousehold("Langstrasse 12", "Mia").household, "Lea");
    const [, lea] = household.members;
    const pasta = createRecipe({ title: "Pasta", servings: 4, ingredientLines: [] });

    expect(planMeal(household, [pasta], "2026-11-04", { recipeId: pasta.id, cookMemberId: lea.id })).toEqual({
      date: "2026-11-04",
      title: "Pasta",
      recipeId: pasta.id,
      cookMemberId: lea.id,
    });
    expect(planMeal(household, [], "2026-11-04", { title: "Leftovers" }).cookMemberId).toBeNull();
    expect(() => planMeal(household, [], "2026-11-04", { recipeId: pasta.id })).toThrow(
      expect.objectContaining({ code: MealErrorCode.UnknownRecipe }),
    );
    expect(() => planMeal(household, [], "2026-11-04", { title: "Pasta", cookMemberId: pasta.id })).toThrow(
      expect.objectContaining({ code: MealErrorCode.UnknownCook }),
    );
    expect(() => planMeal(household, [], "2026-02-30", { title: "Pasta" })).toThrow(
      expect.objectContaining({ code: MealErrorCode.InvalidDate }),
    );
    expect(() => planMeal(household, [], "2026-11-04", {})).toThrow(expect.objectContaining({ code: MealErrorCode.InvalidTitle }));
  });
});
