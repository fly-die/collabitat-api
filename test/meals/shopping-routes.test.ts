import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { ExpenseErrorCode } from "../../src/expenses/expense-errors.js";
import { HttpStatus } from "../../src/http-status.js";
import { MealErrorCode } from "../../src/meals/meal-plan.js";
import { newCredentials } from "../support/credentials.js";

type App = ReturnType<typeof buildApp>;
const WEEK = "from=2026-11-02";

async function household(app: App, name: string) {
  const created = await app.inject({ method: "POST", url: "/households", payload: { name, memberName: "Mia", ...newCredentials(name) } });
  return (created.json() as { token: string }).token;
}

describe("shopping routes", () => {
  let app: App;
  let token: string;

  beforeEach(async () => {
    app = buildApp();
    token = await household(app, "langstrasse");
  });

  afterEach(() => app.close());

  const call = (method: "GET" | "PUT" | "POST" | "DELETE", url: string, payload?: object, as = token) =>
    app.inject({ method, url, headers: { authorization: `Bearer ${as}` }, payload });

  it("lists what the week's dinners need, and what was added by hand", async () => {
    const [pasta] = (await call("POST", `/household/recipes?${WEEK}`, { title: "Pasta", servings: 4, ingredientLines: ["500 g pasta"] })).json().recipes;
    await call("PUT", `/household/meals/2026-11-04?${WEEK}`, { recipeId: pasta.id });
    await call("PUT", `/household/meals/2026-11-12?${WEEK}`, { recipeId: pasta.id });

    const added = await call("POST", `/household/shopping-list/items?${WEEK}`, { line: "  toilet   paper " });

    expect(added.statusCode).toBe(HttpStatus.Created);
    const items = added.json().items;
    expect(items).toEqual([
      expect.objectContaining({ name: "pasta", quantity: 500, unit: "g", category: "pantry", forDinners: ["Pasta"], extraId: null }),
      expect.objectContaining({ name: "toilet paper", category: "household", extraId: expect.any(String) }),
    ]);

    const removed = await call("DELETE", `/household/shopping-list/items/${items[1].extraId}?${WEEK}`);
    expect(removed.json().items).toHaveLength(1);
  });

  it("refuses an empty item and keeps each household's list to itself", async () => {
    expect((await call("POST", `/household/shopping-list/items?${WEEK}`, { line: " " })).json().error).toBe(MealErrorCode.InvalidIngredients);
    await call("POST", `/household/shopping-list/items?${WEEK}`, { line: "Milch" });
    const other = await household(app, "seefeld");

    expect((await call("GET", `/household/shopping-list?${WEEK}`, undefined, other)).json()).toEqual({ from: "2026-11-02", trip: null, items: [] });
  });

  it("puts a recipe's ingredients on the list without planning it, says which recipe, and refuses one that is gone", async () => {
    const [curry] = (await call("POST", `/household/recipes?${WEEK}`, { title: "Curry", servings: 4, ingredientLines: ["1 Dose Kokosmilch", "0.5 kg Reis", "Koriander"] })).json().recipes;

    const added = await call("POST", `/household/shopping-list/recipes/${curry.id}?${WEEK}`);

    expect(added.statusCode).toBe(HttpStatus.Created);
    expect(added.json().addedItemIds).toHaveLength(3);
    type Item = { name: string; quantity: number; unit: string; extraId: string; forDinners: string[] };
    expect(added.json().items.map(({ name, quantity, unit, extraId, forDinners }: Item) => [name, quantity, unit, added.json().addedItemIds.includes(extraId), forDinners])).toEqual(
      expect.arrayContaining([
        ["Kokosmilch", 1, "Dose", true, ["Curry"]],
        ["Reis", 0.5, "kg", true, ["Curry"]],
        ["Koriander", null, null, true, ["Curry"]],
      ]),
    );
    await call("DELETE", `/household/recipes/${curry.id}?${WEEK}`);
    expect((await call("POST", `/household/shopping-list/recipes/${curry.id}?${WEEK}`)).json().error).toBe(MealErrorCode.RecipeNotFound);
  });

  it("puts a recipe on the list for another number of people", async () => {
    const [pasta] = (await call("POST", `/household/recipes?${WEEK}`, { title: "Pasta", servings: 4, ingredientLines: ["500 g pasta", "Salt"] })).json().recipes;

    const forTwo = await call("POST", `/household/shopping-list/recipes/${pasta.id}?${WEEK}&servings=2`);
    const forNone = await call("POST", `/household/shopping-list/recipes/${pasta.id}?${WEEK}&servings=0`);

    expect(forTwo.json().items.map(({ name, quantity, unit }: { name: string; quantity: number; unit: string }) => [name, quantity, unit])).toEqual(
      expect.arrayContaining([
        ["pasta", 250, "g"],
        ["Salt", null, null],
      ]),
    );
    expect(forNone.json().error).toBe(MealErrorCode.InvalidServings);
  });

  it("shares a shopping trip and the ticks with the household until it ends", async () => {
    await call("POST", `/household/shopping-list/items?${WEEK}`, { line: "Zopf" });
    const { currentMemberId } = (await call("GET", "/household")).json();
    expect((await call("GET", "/household/shopping-trip")).json()).toEqual({ trip: null });

    expect((await call("POST", `/household/shopping-trip?${WEEK}`)).statusCode).toBe(HttpStatus.Created);
    const [zopf] = (await call("GET", "/household/shopping-trip")).json().items;
    const ticked = await call("PUT", `/household/shopping-list/checks?${WEEK}`, { key: zopf.key, checked: true });

    expect(ticked.json()).toEqual({
      from: "2026-11-02",
      trip: { shopperMemberId: currentMemberId, from: "2026-11-02", startedAt: expect.any(String) },
      items: [expect.objectContaining({ name: "Zopf", checked: true })],
    });
    expect((await call("DELETE", `/household/shopping-trip?${WEEK}`)).json().trip).toBeNull();
    expect((await call("GET", "/household/shopping-trip")).json()).toEqual({ trip: null });
  });

  it("checks out into a grocery expense and clears what was ticked off by hand", async () => {
    const [pasta] = (await call("POST", `/household/recipes?${WEEK}`, { title: "Pasta", servings: 4, ingredientLines: ["500 g pasta"] })).json().recipes;
    await call("PUT", `/household/meals/2026-11-04?${WEEK}`, { recipeId: pasta.id });
    await call("POST", `/household/shopping-list/items?${WEEK}`, { line: "2 l Milch" });
    await call("POST", `/household/shopping-list/items?${WEEK}`, { line: "toilet paper" });
    const { currentMemberId } = (await call("GET", "/household")).json();
    const started = (await call("POST", `/household/shopping-trip?${WEEK}`)).json();
    for (const item of started.items.filter((candidate: { name: string }) => candidate.name !== "toilet paper")) {
      await call("PUT", `/household/shopping-list/checks?${WEEK}`, { key: item.key, checked: true });
    }
    const groceries = { description: "Groceries", amountCents: 4_270, paidByMemberId: currentMemberId, splitBetweenMemberIds: [currentMemberId], spentOn: "2026-11-04" };

    const refused = await call("POST", `/household/shopping-trip/checkout?${WEEK}`, { ...groceries, amountCents: 0 });
    expect(refused.json().error).toBe(ExpenseErrorCode.InvalidAmount);
    const checkedOut = await call("POST", `/household/shopping-trip/checkout?${WEEK}`, groceries);

    expect(checkedOut.statusCode).toBe(HttpStatus.Created);
    expect(checkedOut.json().trip).toBeNull();
    expect(checkedOut.json().items.map(({ name, checked }: { name: string; checked: boolean }) => [name, checked])).toEqual([
      ["pasta", true],
      ["toilet paper", false],
    ]);
    const { expenses } = (await call("GET", "/household/expenses")).json();
    expect(expenses).toEqual([expect.objectContaining({ id: checkedOut.json().expenseId, description: "Groceries", amountCents: 4_270 })]);
  });
});
