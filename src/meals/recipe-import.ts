import { parse, type HTMLElement } from "node-html-parser";
import { MAX_INGREDIENT_LENGTH, MAX_INGREDIENTS, MAX_SERVINGS, MAX_TITLE_LENGTH, type NewRecipe } from "./meal-plan.js";

// Recipe sites describe their recipe for search engines as schema.org data: most as JSON-LD,
// some (like Swissmilk) as microdata in the page itself. Both are read; nothing else on the page is.

const DEFAULT_SERVINGS = 4;
const RECIPE_TYPE = "Recipe";
// Recipes sit at most a few levels deep, in a @graph or as a page's main entity.
const MAX_SEARCH_DEPTH = 6;

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

const NAMED_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const HEX_RADIX = 16;
const DECIMAL_RADIX = 10;

function decodeEntities(text: string) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
    if (code.startsWith("#x") || code.startsWith("#X")) {
      return String.fromCodePoint(Number.parseInt(code.slice(2), HEX_RADIX));
    }
    if (code.startsWith("#")) {
      return String.fromCodePoint(Number.parseInt(code.slice(1), DECIMAL_RADIX));
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? entity;
  });
}

// Markup becomes a space, so "<td>600 g</td><th>Äpfel</th>" reads "600 g Äpfel".
const cleanText = (text: string) =>
  decodeEntities(text.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();

const isObject = (value: Json): value is JsonObject => typeof value === "object" && value !== null && !Array.isArray(value);

const isRecipe = (value: JsonObject) => {
  const type = value["@type"];
  return type === RECIPE_TYPE || (Array.isArray(type) && type.includes(RECIPE_TYPE));
};

function findRecipe(value: Json, depth = 0): JsonObject | undefined {
  if (depth > MAX_SEARCH_DEPTH) {
    return undefined;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findRecipe(item, depth + 1);
      if (found) {
        return found;
      }
    }
    return undefined;
  }
  if (!isObject(value)) {
    return undefined;
  }
  return isRecipe(value) ? value : findRecipe(Object.values(value), depth + 1);
}

const firstOf = (value: Json | undefined) => (Array.isArray(value) ? value[0] : value);

// "4", 4, "4 Portionen", ["4", "4 servings"]; anything unreadable or out of range becomes the usual 4.
function servingsOf(recipeYield: Json | undefined) {
  const first = firstOf(recipeYield);
  const number = typeof first === "number" ? first : Number(/\d+/.exec(typeof first === "string" ? first : "")?.[0]);
  return Number.isInteger(number) && number >= 1 && number <= MAX_SERVINGS ? number : DEFAULT_SERVINGS;
}

function toRecipe(name: string, recipeYield: Json | undefined, ingredientTexts: string[]): NewRecipe | undefined {
  const title = cleanText(name).slice(0, MAX_TITLE_LENGTH).trim();
  if (title.length === 0) {
    return undefined;
  }
  const ingredientLines = ingredientTexts
    .map((line) => cleanText(line).slice(0, MAX_INGREDIENT_LENGTH).trim())
    .filter((line) => line.length > 0)
    .slice(0, MAX_INGREDIENTS);
  return { title, servings: servingsOf(recipeYield), ingredientLines };
}

function fromJsonLd(page: HTMLElement) {
  for (const script of page.querySelectorAll('script[type="application/ld+json"]')) {
    let data: Json;
    try {
      data = JSON.parse(script.rawText) as Json;
    } catch {
      continue;
    }
    const recipe = findRecipe(data);
    const name = recipe ? firstOf(recipe.name) : undefined;
    if (recipe && typeof name === "string") {
      const ingredients = recipe.recipeIngredient ?? recipe.ingredients;
      const texts = (Array.isArray(ingredients) ? ingredients : []).filter((line): line is string => typeof line === "string");
      const found = toRecipe(name, recipe.recipeYield, texts);
      if (found) {
        return found;
      }
    }
  }
  return undefined;
}

function fromMicrodata(page: HTMLElement) {
  const scope = page.querySelectorAll("[itemtype]").find((element) => /schema\.org\/Recipe$/i.test(element.getAttribute("itemtype") ?? ""));
  if (!scope) {
    return undefined;
  }
  // Only the recipe's own properties: an author's or a rating's name sits in a scope of its own.
  const ownProperties = (property: string) =>
    scope.querySelectorAll(`[itemprop="${property}"]`).filter((element) => element.parentNode?.closest("[itemscope]") === scope);
  const valueOf = (element: HTMLElement) => element.getAttribute("content") ?? element.innerHTML;
  const [name] = ownProperties("name");
  const [recipeYield] = ownProperties("recipeYield");
  return name
    ? toRecipe(valueOf(name), recipeYield ? cleanText(valueOf(recipeYield)) : undefined, ownProperties("recipeIngredient").map(valueOf))
    : undefined;
}

// A recipe ready to check and save, or undefined when the page describes none.
export function readRecipe(html: string): NewRecipe | undefined {
  const page = parse(html);
  return fromJsonLd(page) ?? fromMicrodata(page);
}
