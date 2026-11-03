import type { FastifyInstance } from "fastify";
import { HttpStatus } from "../http-status.js";
import type { Authenticate } from "../sessions/authenticate.js";
import {
  MAX_INGREDIENT_LENGTH,
  MAX_INGREDIENTS,
  MAX_TITLE_LENGTH,
  MealError,
  MealErrorCode,
  createRecipe,
  planMeal,
  validateDate,
  type MealPlan,
  type NewRecipe,
} from "./meal-plan.js";
import type { MealRepository } from "./meal-repository.js";

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
  properties: { title: { type: "string", maxLength: MAX_TITLE_LENGTH * 2 }, recipeId: nullableUuid, cookMemberId: nullableUuid },
} as const;

const dateParams = { type: "object", required: ["date"], properties: { date: isoDate } } as const;
const recipeParams = { type: "object", required: ["recipeId"], properties: { recipeId: uuid } } as const;
const weekQuery = { type: "object", required: ["from"], properties: { from: isoDate } } as const;

interface MealRouteDependencies {
  authenticate: Authenticate;
  mealRepository: MealRepository;
}

const addDays = (isoDay: string, days: number) =>
  new Date(Date.parse(`${isoDay}T00:00:00Z`) + days * MILLISECONDS_PER_DAY).toISOString().slice(0, ISO_DATE_LENGTH);

export function mealRoutes({ authenticate, mealRepository }: MealRouteDependencies) {
  // A week of dinners from `from`, plus all recipes to pick from.
  async function weekView(householdId: string, from: string) {
    validateDate(from);
    const [meals, recipes] = await Promise.all([
      mealRepository.listMeals(householdId, from, addDays(from, DAYS_SHOWN - 1)),
      mealRepository.listRecipes(householdId),
    ]);
    return { from, meals, recipes };
  }

  return async function register(app: FastifyInstance) {
    app.get<{ Querystring: { from: string } }>("/household/meals", { schema: { querystring: weekQuery } }, async (request) => {
      const { household } = await authenticate(request);
      return weekView(household.id, request.query.from);
    });

    app.put<{ Params: { date: string }; Querystring: { from: string }; Body: MealPlan }>(
      "/household/meals/:date",
      { schema: { params: dateParams, querystring: weekQuery, body: mealBodySchema } },
      async (request) => {
        const { household } = await authenticate(request);
        const recipes = await mealRepository.listRecipes(household.id);
        await mealRepository.saveMeal(household.id, planMeal(household, recipes, request.params.date, request.body));
        return weekView(household.id, request.query.from);
      },
    );

    app.delete<{ Params: { date: string }; Querystring: { from: string } }>(
      "/household/meals/:date",
      { schema: { params: dateParams, querystring: weekQuery } },
      async (request) => {
        const { household } = await authenticate(request);
        await mealRepository.removeMeal(household.id, validateDate(request.params.date));
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
