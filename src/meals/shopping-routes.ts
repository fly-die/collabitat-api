import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { ExpenseRepository } from "../expenses/expense-repository.js";
import { newExpenseBodySchema, type ExpenseAddedListener } from "../expenses/expense-routes.js";
import { createExpense, type NewExpense } from "../expenses/expense.js";
import type { Household } from "../households/household.js";
import { HttpStatus } from "../http-status.js";
import type { Authenticate } from "../sessions/authenticate.js";
import { MAX_INGREDIENT_LENGTH, MealError, MealErrorCode, ingredientLine, scaleIngredients, validateDate, validateServings } from "./meal-plan.js";
import type { MealRepository } from "./meal-repository.js";
import type { ShoppingItemRepository } from "./shopping-item-repository.js";
import { buildShoppingList } from "./shopping-list.js";
import type { ShoppingTripRepository } from "./shopping-trip-repository.js";

const DAYS_IN_LIST = 7;
const MILLISECONDS_PER_DAY = 86_400_000;
const ISO_DATE_LENGTH = 10;

const weekQuery = { type: "object", required: ["from"], properties: { from: { type: "string", maxLength: ISO_DATE_LENGTH } } } as const;
const itemBody = {
  type: "object",
  required: ["line"],
  additionalProperties: false,
  properties: { line: { type: "string", maxLength: MAX_INGREDIENT_LENGTH * 2 } },
} as const;
const itemParams = { type: "object", required: ["itemId"], properties: { itemId: { type: "string", format: "uuid" } } } as const;
const recipeParams = { type: "object", required: ["recipeId"], properties: { recipeId: { type: "string", format: "uuid" } } } as const;
// For how many; without it, the recipe's own servings.
const recipeToListQuery = {
  type: "object",
  required: ["from"],
  properties: { from: { type: "string", maxLength: ISO_DATE_LENGTH }, servings: { type: "integer" } },
} as const;
// Keys are "dinner:" or "extra:" plus a name and unit or an id.
const MAX_ITEM_KEY_LENGTH = MAX_INGREDIENT_LENGTH * 2;
const checkBody = {
  type: "object",
  required: ["key", "checked"],
  additionalProperties: false,
  properties: { key: { type: "string", minLength: 1, maxLength: MAX_ITEM_KEY_LENGTH }, checked: { type: "boolean" } },
} as const;

interface ShoppingRouteDependencies {
  authenticate: Authenticate;
  mealRepository: MealRepository;
  shoppingItemRepository: ShoppingItemRepository;
  shoppingTripRepository: ShoppingTripRepository;
  // Called once a trip has started, so the flatmates can hear about it.
  onTripStarted?: (household: Household, shopperMemberId: string) => void;
  expenseRepository: ExpenseRepository;
  onExpenseAdded?: ExpenseAddedListener;
}

export function shoppingRoutes({
  authenticate,
  mealRepository,
  shoppingItemRepository,
  shoppingTripRepository,
  onTripStarted,
  expenseRepository,
  onExpenseAdded,
}: ShoppingRouteDependencies) {
  async function listView(householdId: string, from: string) {
    validateDate(from);
    const to = new Date(Date.parse(`${from}T00:00:00Z`) + (DAYS_IN_LIST - 1) * MILLISECONDS_PER_DAY).toISOString().slice(0, ISO_DATE_LENGTH);
    const [meals, recipes, extras, checkedKeys, trip] = await Promise.all([
      mealRepository.listMeals(householdId, from, to),
      mealRepository.listRecipes(householdId),
      shoppingItemRepository.list(householdId),
      shoppingTripRepository.listChecked(householdId, from),
      shoppingTripRepository.find(householdId),
    ]);
    return { from, trip: trip ?? null, items: buildShoppingList(meals, recipes, extras, checkedKeys) };
  }

  return async function register(app: FastifyInstance) {
    app.get<{ Querystring: { from: string } }>("/household/shopping-list", { schema: { querystring: weekQuery } }, async (request) => {
      const { household } = await authenticate(request);
      return listView(household.id, request.query.from);
    });

    app.post<{ Querystring: { from: string }; Body: { line: string } }>(
      "/household/shopping-list/items",
      { schema: { querystring: weekQuery, body: itemBody } },
      async (request, reply) => {
        const { household } = await authenticate(request);
        const line = request.body.line.trim().replace(/\s+/g, " ");
        if (line.length === 0 || line.length > MAX_INGREDIENT_LENGTH) {
          throw new MealError(MealErrorCode.InvalidIngredients, `Write the item in 1 to ${MAX_INGREDIENT_LENGTH} characters.`);
        }
        await shoppingItemRepository.add(household.id, { id: randomUUID(), line, createdAt: new Date().toISOString(), recipeTitle: null });
        return reply.status(HttpStatus.Created).send(await listView(household.id, request.query.from));
      },
    );

    // A recipe's ingredients go on the list as items added by hand, without planning it as a dinner.
    app.post<{ Params: { recipeId: string }; Querystring: { from: string; servings?: number } }>(
      "/household/shopping-list/recipes/:recipeId",
      { schema: { params: recipeParams, querystring: recipeToListQuery } },
      async (request, reply) => {
        const { household } = await authenticate(request);
        validateDate(request.query.from);
        const recipe = (await mealRepository.listRecipes(household.id)).find((candidate) => candidate.id === request.params.recipeId);
        if (!recipe) {
          throw new MealError(MealErrorCode.RecipeNotFound, "That recipe is already gone.");
        }
        const servings = validateServings(request.query.servings ?? recipe.servings);
        const now = Date.now();
        const items = scaleIngredients(recipe, servings).map((ingredient, index) => ({
          id: randomUUID(),
          line: ingredientLine(ingredient),
          // Apart by a millisecond each, so they keep the recipe's order.
          createdAt: new Date(now + index).toISOString(),
          recipeTitle: recipe.title,
        }));
        await Promise.all(items.map((item) => shoppingItemRepository.add(household.id, item)));
        const view = await listView(household.id, request.query.from);
        return reply.status(HttpStatus.Created).send({ ...view, addedItemIds: items.map((item) => item.id) });
      },
    );

    app.delete<{ Params: { itemId: string }; Querystring: { from: string } }>(
      "/household/shopping-list/items/:itemId",
      { schema: { params: itemParams, querystring: weekQuery } },
      async (request) => {
        const { household } = await authenticate(request);
        await shoppingItemRepository.remove(household.id, request.params.itemId);
        return listView(household.id, request.query.from);
      },
    );

    app.put<{ Querystring: { from: string }; Body: { key: string; checked: boolean } }>(
      "/household/shopping-list/checks",
      { schema: { querystring: weekQuery, body: checkBody } },
      async (request) => {
        const { household } = await authenticate(request);
        validateDate(request.query.from);
        await shoppingTripRepository.setChecked(household.id, request.query.from, request.body.key, request.body.checked);
        return listView(household.id, request.query.from);
      },
    );

    // For Home: the list someone is shopping right now, whichever week it is.
    app.get("/household/shopping-trip", async (request) => {
      const { household } = await authenticate(request);
      const trip = await shoppingTripRepository.find(household.id);
      return trip ? listView(household.id, trip.from) : { trip: null };
    });

    app.post<{ Querystring: { from: string } }>("/household/shopping-trip", { schema: { querystring: weekQuery } }, async (request, reply) => {
      const { household, currentMemberId } = await authenticate(request);
      validateDate(request.query.from);
      await shoppingTripRepository.start(household.id, {
        shopperMemberId: currentMemberId,
        from: request.query.from,
        startedAt: new Date().toISOString(),
      });
      onTripStarted?.(household, currentMemberId);
      return reply.status(HttpStatus.Created).send(await listView(household.id, request.query.from));
    });

    app.delete<{ Querystring: { from: string } }>("/household/shopping-trip", { schema: { querystring: weekQuery } }, async (request) => {
      const { household } = await authenticate(request);
      await shoppingTripRepository.end(household.id);
      return listView(household.id, request.query.from);
    });

    // Paying ends the trip: the groceries become an expense and what was ticked off by hand leaves the list.
    app.post<{ Querystring: { from: string }; Body: NewExpense }>(
      "/household/shopping-trip/checkout",
      { schema: { querystring: weekQuery, body: newExpenseBodySchema } },
      async (request, reply) => {
        const { household, currentMemberId } = await authenticate(request);
        const { items } = await listView(household.id, request.query.from);
        const expense = createExpense(household, request.body);
        await expenseRepository.add(household.id, expense);
        onExpenseAdded?.(household, expense, currentMemberId);
        const boughtExtraIds = items.flatMap((item) => (item.checked && item.extraId ? [item.extraId] : []));
        await Promise.all(boughtExtraIds.map((extraId) => shoppingItemRepository.remove(household.id, extraId)));
        await shoppingTripRepository.end(household.id);
        return reply.status(HttpStatus.Created).send({ ...(await listView(household.id, request.query.from)), expenseId: expense.id });
      },
    );
  };
}
