import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { HttpStatus } from "../../src/http-status.js";
import { MealErrorCode } from "../../src/meals/meal-plan.js";
import { PageFetchError } from "../../src/meals/page-fetcher.js";
import { newCredentials } from "../support/credentials.js";

const RECIPE_PAGE = `<script type="application/ld+json">${JSON.stringify({
  "@type": "Recipe",
  name: "Curry",
  recipeYield: "2",
  recipeIngredient: ["1 Dose Kokosmilch", "200 g Reis"],
})}</script>`;

// Stands in for the web: a recipe page, a page without one, an unreachable site and a refused link.
async function fakePage(link: string) {
  if (link.endsWith("/curry")) {
    return RECIPE_PAGE;
  }
  if (link.endsWith("/news")) {
    return "<p>No recipe</p>";
  }
  if (link.endsWith("/down")) {
    throw new PageFetchError("unreachable", "Couldn't open that page.");
  }
  if (link.endsWith("/bug")) {
    throw new Error("Something unexpected");
  }
  throw new PageFetchError("invalid-link", "That link can't be opened.");
}

describe("recipe import route", () => {
  let app: ReturnType<typeof buildApp>;
  let token: string;

  beforeEach(async () => {
    app = buildApp({ fetchPage: fakePage });
    const created = await app.inject({ method: "POST", url: "/households", payload: { name: "Flat", memberName: "Mia", ...newCredentials("flat") } });
    token = (created.json() as { token: string }).token;
  });

  afterEach(() => app.close());

  const importLink = (link: string, authorization = `Bearer ${token}`) =>
    app.inject({ method: "POST", url: "/household/recipe-import", headers: { authorization }, payload: { link } });

  it("reads a recipe from a page without saving it", async () => {
    const imported = await importLink("https://example.com/curry");

    expect(imported.statusCode).toBe(HttpStatus.Ok);
    expect(imported.json()).toEqual({ title: "Curry", servings: 2, ingredientLines: ["1 Dose Kokosmilch", "200 g Reis"] });
    const week = await app.inject({ method: "GET", url: "/household/meals?from=2026-11-02", headers: { authorization: `Bearer ${token}` } });
    expect(week.json().recipes).toEqual([]);
  });

  it("says why a page can't be imported", async () => {
    expect((await importLink("https://example.com/news")).json().error).toBe(MealErrorCode.NoRecipeOnPage);
    expect((await importLink("https://example.com/down")).statusCode).toBe(HttpStatus.UnprocessableContent);
    const refused = await importLink("https://127.0.0.1/");
    expect(refused.statusCode).toBe(HttpStatus.BadRequest);
    expect(refused.json().error).toBe(MealErrorCode.InvalidLink);
  });

  it("lets anything unexpected through as a server error", async () => {
    expect((await importLink("https://example.com/bug")).statusCode).toBe(HttpStatus.InternalServerError);
  });

  it("allows a household a few imports a minute", async () => {
    const statuses = [];
    for (let attempt = 0; attempt < 11; attempt += 1) {
      statuses.push((await importLink("https://example.com/curry")).statusCode);
    }

    expect(statuses.slice(0, 10).every((status) => status === HttpStatus.Ok)).toBe(true);
    expect(statuses[10]).toBe(HttpStatus.TooManyRequests);
  });

  it("needs a household", async () => {
    expect((await importLink("https://example.com/curry", "Bearer nope")).statusCode).toBe(HttpStatus.Unauthorized);
  });
});
