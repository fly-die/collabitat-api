import { describe, expect, it } from "vitest";
import { createRecipe } from "../../src/meals/meal-plan.js";
import { buildShoppingList, categorize } from "../../src/meals/shopping-list.js";

const dinner = (date: string, title: string, recipeId: string | null) => ({ date, title, recipeId, cookMemberId: null });

describe("shopping list", () => {
  it.each([
    ["Tomaten", null, "produce"],
    ["onions", null, "produce"],
    ["Eisbergsalat", null, "produce"],
    ["Zopf", null, "bakery"],
    ["Rahm", null, "dairy"],
    ["Ei", null, "dairy"],
    ["eggs", null, "dairy"],
    ["Hackfleisch", null, "meat-fish"],
    ["spaghetti", null, "pantry"],
    ["Kokosmilch", null, "pantry"],
    ["Olivenöl", null, "pantry"],
    ["Tomaten", "dose", "pantry"],
    ["Glace", null, "frozen"],
    ["Mineralwasser", null, "drinks"],
    ["toilet paper", null, "household"],
    ["Batterien", null, "other"],
  ])("puts %j (%s) in %s", (name, unit, category) => {
    expect(categorize(name, unit)).toBe(category);
  });

  it("adds up the same ingredient across dinners and units, in shop order", () => {
    const pasta = createRecipe({ title: "Pasta", servings: 4, ingredientLines: ["250 g pasta", "5 dl Rahm", "Salt", "2 Dosen Tomaten"] });
    const lasagne = createRecipe({ title: "Lasagne", servings: 4, ingredientLines: ["1 kg Pasta", "500 ml rahm", "salt", "1 can tomaten"] });
    const meals = [dinner("2026-11-02", "Pasta", pasta.id), dinner("2026-11-03", "Lasagne", lasagne.id), dinner("2026-11-04", "Leftovers", null)];

    const list = buildShoppingList(meals, [pasta, lasagne], [{ id: "extra-1", line: "2 l Milch", createdAt: "2026-11-01T10:00:00Z" }]);

    expect(list.map(({ name, quantity, unit, category, forDinners, extraId }) => [name, quantity, unit, category, forDinners, extraId])).toEqual([
      ["Milch", 2, "l", "dairy", [], "extra-1"],
      ["Rahm", 1, "l", "dairy", ["Pasta", "Lasagne"], null],
      ["pasta", 1.25, "kg", "pantry", ["Pasta", "Lasagne"], null],
      ["Salt", null, null, "pantry", ["Pasta", "Lasagne"], null],
      ["Tomaten", 3, "dose", "pantry", ["Pasta", "Lasagne"], null],
    ]);
  });

  it("shows small amounts in their own unit", () => {
    const soup = createRecipe({ title: "Soup", servings: 2, ingredientLines: ["50 ml cream", "3 dl stock", "80 g butter"] });

    const list = buildShoppingList([dinner("2026-11-02", "Soup", soup.id)], [soup], []);

    expect(list.map(({ name, quantity, unit }) => `${quantity} ${unit} ${name}`)).toEqual(["80 g butter", "50 ml cream", "3 dl stock"]);
  });
});
