import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { HttpStatus } from "../http-status.js";
import type { Authenticate } from "../sessions/authenticate.js";
import { MAX_INGREDIENT_LENGTH, MealError, MealErrorCode, validateDate } from "./meal-plan.js";
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
}

export function shoppingRoutes({
  authenticate,
  mealRepository,
  shoppingItemRepository,
  shoppingTripRepository,
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
        await shoppingItemRepository.add(household.id, { id: randomUUID(), line, createdAt: new Date().toISOString() });
        return reply.status(HttpStatus.Created).send(await listView(household.id, request.query.from));
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
      return reply.status(HttpStatus.Created).send(await listView(household.id, request.query.from));
    });

    app.delete<{ Querystring: { from: string } }>("/household/shopping-trip", { schema: { querystring: weekQuery } }, async (request) => {
      const { household } = await authenticate(request);
      await shoppingTripRepository.end(household.id);
      return listView(household.id, request.query.from);
    });
  };
}
