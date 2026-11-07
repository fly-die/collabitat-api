import type { FastifyInstance } from "fastify";
import { HttpStatus } from "../http-status.js";
import { RECIPE_IMPORT_PATH } from "../live/live-hub.js";
import type { Authenticate } from "../sessions/authenticate.js";
import {
  MAX_INGREDIENT_LENGTH,
  MAX_INGREDIENTS,
  MAX_TITLE_LENGTH,
  MealError,
  MealErrorCode,
  DEFAULT_SLOT,
  MEAL_SLOTS,
  createRecipe,
  planMeal,
  summarizePastMeals,
  validateDate,
  validateMealTimes,
  type MealPlan,
  type MealSlot,
  type MealTimes,
  type NewRecipe,
} from "./meal-plan.js";
import type { MealRepository } from "./meal-repository.js";
import { PageFetchError, type FetchPage } from "./page-fetcher.js";
import { readRecipe } from "./recipe-import.js";

const DAYS_SHOWN = 7;
const MILLISECONDS_PER_DAY = 86_400_000;
const ISO_DATE_LENGTH = 10;

const uuid = { type: "string", format: "uuid" } as const;
const nullableUuid = { anyOf: [uuid, { type: "null" }] } as const;
const isoDate = { type: "string", maxLength: ISO_DATE_LENGTH } as const;

const recipeBodySchema = {
  type: "object",
  required: ["title", "servings", "ingredientLines"],
  additionalProperties: false,
  properties: {
    title: { type: "string", maxLength: MAX_TITLE_LENGTH * 2 },
    servings: { type: "number" },
    ingredientLines: { type: "array", maxItems: MAX_INGREDIENTS * 2, items: { type: "string", maxLength: MAX_INGREDIENT_LENGTH * 2 } },
  },
} as const;

const mealBodySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string", maxLength: MAX_TITLE_LENGTH * 2 },
    recipeId: nullableUuid,
    cookMemberId: nullableUuid,
    servings: { anyOf: [{ type: "number" }, { type: "null" }] },
  },
} as const;

const dateParams = { type: "object", required: ["date"], properties: { date: isoDate } } as const;
const recipeParams = { type: "object", required: ["recipeId"], properties: { recipeId: uuid } } as const;
const weekQuery = { type: "object", required: ["from"], properties: { from: isoDate } } as const;
// Which meal of the day; without it, dinner.
const mealQuery = { type: "object", required: ["from"], properties: { from: isoDate, slot: { type: "string", enum: MEAL_SLOTS } } } as const;
const weekdays = { type: "array", maxItems: 7, items: { type: "integer" } } as const;
const historyQuery = { type: "object", required: ["before"], properties: { before: isoDate } } as const;
const DAYS_OF_HISTORY = 365;
const mealTimesBody = {
  type: "object",
  required: ["breakfast", "lunch"],
  additionalProperties: false,
  properties: { breakfast: weekdays, lunch: weekdays },
} as const;

const MAX_LINK_LENGTH = 2000;
const importBody = {
  type: "object",
  required: ["link"],
  additionalProperties: false,
  properties: { link: { type: "string", maxLength: MAX_LINK_LENGTH } },
} as const;
// Each import makes the server open a page somewhere else, so a household gets a few a minute.
const IMPORTS_PER_WINDOW = 10;
const IMPORT_WINDOW = "1 minute";

interface MealRouteDependencies {
  authenticate: Authenticate;
  mealRepository: MealRepository;
  fetchPage: FetchPage;
}

const addDays = (isoDay: string, days: number) =>
  new Date(Date.parse(`${isoDay}T00:00:00Z`) + days * MILLISECONDS_PER_DAY).toISOString().slice(0, ISO_DATE_LENGTH);

export function mealRoutes({ authenticate, mealRepository, fetchPage }: MealRouteDependencies) {
  // A week of meals from `from`, the weekdays with breakfast or lunch, and all recipes to pick from.
  async function weekView(householdId: string, from: string) {
    validateDate(from);
    const [meals, recipes, mealTimes] = await Promise.all([
      mealRepository.listMeals(householdId, from, addDays(from, DAYS_SHOWN - 1)),
      mealRepository.listRecipes(householdId),
      mealRepository.getMealTimes(householdId),
    ]);
    return { from, meals, recipes, mealTimes };
  }

  return async function register(app: FastifyInstance) {
    app.get<{ Querystring: { from: string } }>("/household/meals", { schema: { querystring: weekQuery } }, async (request) => {
      const { household } = await authenticate(request);
      return weekView(household.id, request.query.from);
    });

    // What the household had in the year before `before` (usually today), to plan again.
    app.get<{ Querystring: { before: string } }>("/household/meals/history", { schema: { querystring: historyQuery } }, async (request) => {
      const { household } = await authenticate(request);
      const before = validateDate(request.query.before);
      const meals = await mealRepository.listMeals(household.id, addDays(before, -DAYS_OF_HISTORY), addDays(before, -1));
      return { pastMeals: summarizePastMeals(meals) };
    });

    app.put<{ Params: { date: string }; Querystring: { from: string; slot?: MealSlot }; Body: MealPlan }>(
      "/household/meals/:date",
      { schema: { params: dateParams, querystring: mealQuery, body: mealBodySchema } },
      async (request) => {
        const { household } = await authenticate(request);
        const recipes = await mealRepository.listRecipes(household.id);
        const slot = request.query.slot ?? DEFAULT_SLOT;
        await mealRepository.saveMeal(household.id, planMeal(household, recipes, request.params.date, request.body, slot));
        return weekView(household.id, request.query.from);
      },
    );

    app.delete<{ Params: { date: string }; Querystring: { from: string; slot?: MealSlot } }>(
      "/household/meals/:date",
      { schema: { params: dateParams, querystring: mealQuery } },
      async (request) => {
        const { household } = await authenticate(request);
        await mealRepository.removeMeal(household.id, validateDate(request.params.date), request.query.slot ?? DEFAULT_SLOT);
        return weekView(household.id, request.query.from);
      },
    );

    app.put<{ Querystring: { from: string }; Body: MealTimes }>(
      "/household/meal-times",
      { schema: { querystring: weekQuery, body: mealTimesBody } },
      async (request) => {
        const { household } = await authenticate(request);
        await mealRepository.saveMealTimes(household.id, validateMealTimes(request.body));
        return weekView(household.id, request.query.from);
      },
    );

    app.post<{ Querystring: { from: string }; Body: NewRecipe }>(
      "/household/recipes",
      { schema: { querystring: weekQuery, body: recipeBodySchema } },
      async (request, reply) => {
        const { household } = await authenticate(request);
        await mealRepository.addRecipe(household.id, createRecipe(request.body));
        return reply.status(HttpStatus.Created).send(await weekView(household.id, request.query.from));
      },
    );

    // Reads a recipe from a web page for the person to check; nothing is saved until they do.
    app.post<{ Body: { link: string } }>(
      RECIPE_IMPORT_PATH,
      {
        schema: { body: importBody },
        config: {
          rateLimit: {
            max: IMPORTS_PER_WINDOW,
            timeWindow: IMPORT_WINDOW,
            hook: "preHandler",
            keyGenerator: (request) => request.headers.authorization ?? request.ip,
          },
        },
      },
      async (request) => {
        await authenticate(request);
        let html: string;
        try {
          html = await fetchPage(request.body.link.trim());
        } catch (error) {
          if (error instanceof PageFetchError) {
            throw new MealError(error.reason === "invalid-link" ? MealErrorCode.InvalidLink : MealErrorCode.PageUnreachable, error.message);
          }
          throw error;
        }
        const recipe = readRecipe(html);
        if (!recipe) {
          throw new MealError(MealErrorCode.NoRecipeOnPage, "That page has no recipe we can read. Type it in instead.");
        }
        return recipe;
      },
    );

    app.put<{ Params: { recipeId: string }; Querystring: { from: string }; Body: NewRecipe }>(
      "/household/recipes/:recipeId",
      { schema: { params: recipeParams, querystring: weekQuery, body: recipeBodySchema } },
      async (request) => {
        const { household } = await authenticate(request);
        const existing = (await mealRepository.listRecipes(household.id)).find((recipe) => recipe.id === request.params.recipeId);
        if (!existing) {
          throw new MealError(MealErrorCode.RecipeNotFound, "That recipe is already gone.");
        }
        await mealRepository.updateRecipe(household.id, createRecipe(request.body, existing));
        return weekView(household.id, request.query.from);
      },
    );

    app.delete<{ Params: { recipeId: string }; Querystring: { from: string } }>(
      "/household/recipes/:recipeId",
      { schema: { params: recipeParams, querystring: weekQuery } },
      async (request) => {
        const { household } = await authenticate(request);
        if (!(await mealRepository.removeRecipe(household.id, request.params.recipeId))) {
          throw new MealError(MealErrorCode.RecipeNotFound, "That recipe is already gone.");
        }
        return weekView(household.id, request.query.from);
      },
    );
  };
}
