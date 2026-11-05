import { randomUUID } from "node:crypto";
import type { Household } from "../households/household.js";

export const MealErrorCode = {
  InvalidTitle: "INVALID_TITLE",
  InvalidServings: "INVALID_SERVINGS",
  InvalidIngredients: "INVALID_INGREDIENTS",
  InvalidDate: "INVALID_DATE",
  UnknownRecipe: "UNKNOWN_RECIPE",
  UnknownCook: "UNKNOWN_COOK",
  RecipeNotFound: "RECIPE_NOT_FOUND",
} as const;

export type MealErrorCode = (typeof MealErrorCode)[keyof typeof MealErrorCode];

export class MealError extends Error {
  constructor(
    readonly code: MealErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "MealError";
  }
}

export const MAX_TITLE_LENGTH = 80;
export const MAX_SERVINGS = 50;
export const MAX_INGREDIENTS = 60;
export const MAX_INGREDIENT_LENGTH = 100;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATE_LENGTH = 10;
const QUANTITY_PATTERN = /^(\d+(?:[.,]\d+)?|\d+\/\d+)$/;
// Units as people write them in Swiss and English recipes; anything else stays part of the name.
const UNITS = new Set([
  "g", "kg", "mg", "ml", "cl", "dl", "l", "tl", "el", "tsp", "tbsp", "cup", "cups",
  "pcs", "stk", "stück", "prise", "pinch", "bund", "dose", "dosen", "can", "cans", "pack", "packung", "zehe", "zehen",
]);

export interface Ingredient {
  quantity: number | null;
  unit: string | null;
  name: string;
}

export interface Recipe {
  id: string;
  title: string;
  servings: number;
  ingredients: Ingredient[];
  createdAt: string;
}

export interface NewRecipe {
  title: string;
  servings: number;
  ingredientLines: string[];
}

// One dinner per day: free text, or a saved recipe, and optionally who cooks.
export interface PlannedMeal {
  date: string;
  title: string;
  recipeId: string | null;
  cookMemberId: string | null;
}

export interface MealPlan {
  title?: string;
  recipeId?: string | null;
  cookMemberId?: string | null;
}

function normalizeTitle(raw: string) {
  const title = raw.trim().replace(/\s+/g, " ");
  if (title.length === 0 || title.length > MAX_TITLE_LENGTH) {
    throw new MealError(MealErrorCode.InvalidTitle, `Give it a name of 1 to ${MAX_TITLE_LENGTH} characters.`);
  }
  return title;
}

export function validateDate(isoDate: string) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  if (!ISO_DATE_PATTERN.test(isoDate) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, ISO_DATE_LENGTH) !== isoDate) {
    throw new MealError(MealErrorCode.InvalidDate, "Pick a valid date.");
  }
  return isoDate;
}

function parseQuantity(token: string) {
  const [numerator, denominator] = token.replace(",", ".").split("/").map(Number);
  return denominator ? numerator / denominator : numerator;
}

// "500 g pasta" → 500, g, pasta. "2 onions" → 2, no unit. "Salt" → just the name.
export function parseIngredient(line: string): Ingredient {
  const words = line.trim().replace(/\s+/g, " ").split(" ");
  const quantity = words.length > 1 && QUANTITY_PATTERN.test(words[0]) ? parseQuantity(words.shift() as string) : null;
  const unitWord = words.length > 1 ? words[0].replace(/\.$/, "").toLocaleLowerCase("de-CH") : "";
  const unit = quantity !== null && UNITS.has(unitWord) ? (words.shift(), unitWord) : null;
  return { quantity, unit, name: words.join(" ") };
}

// Pass the existing recipe when editing, so it keeps its id and creation time.
export function createRecipe(newRecipe: NewRecipe, existing?: Recipe): Recipe {
  if (!Number.isInteger(newRecipe.servings) || newRecipe.servings < 1 || newRecipe.servings > MAX_SERVINGS) {
    throw new MealError(MealErrorCode.InvalidServings, `Servings go from 1 to ${MAX_SERVINGS}.`);
  }
  const lines = newRecipe.ingredientLines.map((line) => line.trim()).filter((line) => line.length > 0);
  if (lines.length > MAX_INGREDIENTS || lines.some((line) => line.length > MAX_INGREDIENT_LENGTH)) {
    throw new MealError(
      MealErrorCode.InvalidIngredients,
      `Up to ${MAX_INGREDIENTS} ingredients, each up to ${MAX_INGREDIENT_LENGTH} characters.`,
    );
  }
  return {
    id: existing?.id ?? randomUUID(),
    title: normalizeTitle(newRecipe.title),
    servings: newRecipe.servings,
    ingredients: lines.map(parseIngredient),
    createdAt: existing?.createdAt ?? new Date().toISOString(),
  };
}

// A recipe without a typed title names the dinner after itself.
export function planMeal(household: Household, recipes: Recipe[], date: string, plan: MealPlan): PlannedMeal {
  const recipe = plan.recipeId ? recipes.find((candidate) => candidate.id === plan.recipeId) : undefined;
  if (plan.recipeId && !recipe) {
    throw new MealError(MealErrorCode.UnknownRecipe, "That recipe is gone.");
  }
  const cookMemberId = plan.cookMemberId ?? null;
  if (cookMemberId && !household.members.some((member) => member.id === cookMemberId)) {
    throw new MealError(MealErrorCode.UnknownCook, "The cook isn't in this household.");
  }
  return {
    date: validateDate(date),
    title: normalizeTitle(plan.title?.trim() ? plan.title : (recipe?.title ?? "")),
    recipeId: recipe?.id ?? null,
    cookMemberId,
  };
}
