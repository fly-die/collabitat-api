import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
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

});
