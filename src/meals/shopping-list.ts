import { parseIngredient, type Ingredient, type PlannedMeal, type Recipe } from "./meal-plan.js";

// In the order you walk through a typical Swiss supermarket.
export const CATEGORY_ORDER = ["produce", "bakery", "dairy", "meat-fish", "pantry", "frozen", "drinks", "household", "other"] as const;
export type GroceryCategory = (typeof CATEGORY_ORDER)[number];

// German and English word starts, lower case; the longest match wins, so "kokosmilch" is pantry, not dairy.
const KEYWORDS: Record<Exclude<GroceryCategory, "other">, string[]> = {
  produce: ["apfel", "äpfel", "apple", "banan", "birne", "pear", "zitron", "lemon", "limette", "lime", "orange", "beeren", "berries", "erdbeer", "strawberr", "tomat", "gurke", "cucumber", "salat", "lettuce", "eisberg", "rucola", "spinat", "spinach", "kartoffel", "potato", "zwiebel", "onion", "knoblauch", "garlic", "karotte", "rüebli", "carrot", "paprika", "zucchetti", "zucchini", "aubergine", "broccoli", "blumenkohl", "cauliflower", "lauch", "leek", "sellerie", "celery", "pilz", "champignon", "mushroom", "kräuter", "herbs", "basilikum", "basil", "petersilie", "parsley", "koriander", "coriander", "ingwer", "ginger", "avocado", "kürbis", "pumpkin", "fenchel", "fennel", "kohl", "cabbage"],
  bakery: ["brot", "bread", "zopf", "gipfeli", "croissant", "brötchen", "weggli", "toast", "baguette", "tortilla", "wrap", "pita", "naan"],
  dairy: ["milch", "milk", "rahm", "cream", "sahne", "butter", "käse", "cheese", "parmesan", "mozzarella", "feta", "gruyère", "emmentaler", "raclette", "joghurt", "jogurt", "yogurt", "yoghurt", "quark", "mascarpone", "ricotta", "ei", "eier", "egg", "eggs", "crème fraîche", "creme fraiche", "schmand"],
  "meat-fish": ["fleisch", "meat", "rind", "beef", "schwein", "pork", "poulet", "chicken", "huhn", "hack", "mince", "speck", "bacon", "schinken", "ham", "wurst", "sausage", "salami", "lachs", "salmon", "thon", "tuna", "fisch", "fish", "crevette", "shrimp", "prawn", "lamm", "lamb"],
  pantry: ["pasta", "spaghetti", "penne", "nudel", "noodle", "teigwaren", "magronen", "hörnli", "reis", "rice", "risotto", "couscous", "quinoa", "linsen", "lentil", "bohnen", "beans", "kichererbsen", "chickpea", "mehl", "flour", "zucker", "sugar", "salz", "salt", "pfeffer", "pepper", "öl", "oil", "olivenöl", "rapsöl", "essig", "vinegar", "sauce", "sosse", "senf", "mustard", "ketchup", "mayonnaise", "honig", "honey", "konfi", "jam", "müesli", "muesli", "haferflocken", "oats", "gewürz", "spice", "curry", "bouillon", "stock", "brühe", "tomatenpüree", "passata", "kokosmilch", "coconut milk", "nüsse", "nuts", "schokolade", "chocolate", "kaffee", "coffee", "tee", "tea"],
  frozen: ["tiefkühl", "frozen", "glace", "ice cream", "eis"],
  drinks: ["wasser", "water", "mineral", "saft", "juice", "bier", "beer", "wein", "wine", "cola", "sirup", "syrup"],
  household: ["toilettenpapier", "toilet paper", "wc-papier", "haushaltpapier", "kitchen roll", "putzmittel", "detergent", "waschmittel", "abwaschmittel", "dish soap", "seife", "soap", "schwamm", "sponge", "kehrichtsäcke", "abfallsäcke", "bin bags", "trash bags", "alufolie", "foil", "backpapier", "baking paper", "zahnpasta", "toothpaste", "shampoo"],
};
// Words this short have to stand alone: "Ei" is an egg, "Eisbergsalat" is not.
const WHOLE_WORD_UP_TO = 3;
const KEYWORDS_LONGEST_FIRST = Object.entries(KEYWORDS)
  .flatMap(([category, words]) => words.map((word) => ({ category: category as GroceryCategory, word })))
  .sort((first, second) => second.word.length - first.word.length);
// Tinned goods live on the shelves, whatever is inside the tin.
const PANTRY_UNITS = new Set(["dose", "pack"]);

function matchesWord(text: string, word: string) {
  for (let index = text.indexOf(word); index !== -1; index = text.indexOf(word, index + 1)) {
    const startsWord = index === 0 || !/\p{L}/u.test(text[index - 1]);
    const endsWord = !/\p{L}/u.test(text[index + word.length] ?? "");
    if (startsWord && (word.length > WHOLE_WORD_UP_TO || endsWord)) {
      return true;
    }
  }
  return false;
}

export function categorize(name: string, unit: string | null = null): GroceryCategory {
  if (unit && PANTRY_UNITS.has(unit)) {
    return "pantry";
  }
  const text = name.toLocaleLowerCase("de-CH");
  return KEYWORDS_LONGEST_FIRST.find(({ word }) => matchesWord(text, word))?.category ?? "other";
}

// Units that mean the same; counts ("2 Stück") need no unit at all.
const UNIT_SYNONYMS: Record<string, string | null> = {
  tsp: "tl", tbsp: "el", cups: "cup", stk: null, stück: null, pcs: null,
  dosen: "dose", can: "dose", cans: "dose", packung: "pack", zehen: "zehe",
};
// Mass and volume add up across units: everything is counted in g or ml, then shown in the handiest unit.
const BASE_UNITS: Record<string, { base: "g" | "ml"; factor: number }> = {
  mg: { base: "g", factor: 0.001 }, g: { base: "g", factor: 1 }, kg: { base: "g", factor: 1000 },
  ml: { base: "ml", factor: 1 }, cl: { base: "ml", factor: 10 }, dl: { base: "ml", factor: 100 }, l: { base: "ml", factor: 1000 },
};
const GRAMS_PER_KILO = 1000;
const MILLILITRES_PER_LITRE = 1000;
const MILLILITRES_PER_DECILITRE = 100;

const canonicalUnit = (unit: string | null) => (unit !== null && unit in UNIT_SYNONYMS ? UNIT_SYNONYMS[unit] : unit);
const rounded = (value: number) => Number(value.toFixed(2));

function display(quantity: number | null, unit: string | null) {
  if (quantity === null || (unit !== "g" && unit !== "ml")) {
    return { quantity: quantity === null ? null : rounded(quantity), unit };
  }
  if (unit === "g") {
    return quantity >= GRAMS_PER_KILO ? { quantity: rounded(quantity / GRAMS_PER_KILO), unit: "kg" } : { quantity: rounded(quantity), unit };
  }
  if (quantity >= MILLILITRES_PER_LITRE) {
    return { quantity: rounded(quantity / MILLILITRES_PER_LITRE), unit: "l" };
  }
  return quantity >= MILLILITRES_PER_DECILITRE
    ? { quantity: rounded(quantity / MILLILITRES_PER_DECILITRE), unit: "dl" }
    : { quantity: rounded(quantity), unit };
}

export interface ShoppingItem {
  name: string;
  quantity: number | null;
  unit: string | null;
  category: GroceryCategory;
  // The dinners that need it; empty for an item someone added by hand.
  forDinners: string[];
  // Set for items added by hand, so they can be removed again.
  extraId: string | null;
}

export interface ExtraItem {
  id: string;
  line: string;
  createdAt: string;
}

interface Need {
  ingredient: Ingredient;
  dinner: string;
}

function mergeNeeds(needs: Need[]) {
  const merged = new Map<string, { name: string; quantity: number | null; unit: string | null; forDinners: string[] }>();
  for (const { ingredient, dinner } of needs) {
    const unit = canonicalUnit(ingredient.unit);
    const base = unit ? BASE_UNITS[unit] : undefined;
    const quantity = ingredient.quantity === null ? null : ingredient.quantity * (base?.factor ?? 1);
    const key = `${ingredient.name.toLocaleLowerCase("de-CH")}|${base?.base ?? unit ?? ""}`;
    const existing = merged.get(key);
    if (existing) {
      existing.quantity = existing.quantity === null || quantity === null ? (existing.quantity ?? quantity) : existing.quantity + quantity;
      if (!existing.forDinners.includes(dinner)) {
        existing.forDinners.push(dinner);
      }
    } else {
      merged.set(key, { name: ingredient.name, quantity, unit: base?.base ?? unit, forDinners: [dinner] });
    }
  }
  return [...merged.values()];
}

const byShopOrder = (first: ShoppingItem, second: ShoppingItem) =>
  CATEGORY_ORDER.indexOf(first.category) - CATEGORY_ORDER.indexOf(second.category) || first.name.localeCompare(second.name, "de-CH");

// The week's list: every ingredient of every planned dinner that uses a recipe, added up, plus what was added by hand.
export function buildShoppingList(meals: PlannedMeal[], recipes: Recipe[], extras: ExtraItem[]): ShoppingItem[] {
  const needs = meals.flatMap((meal) => {
    const recipe = recipes.find((candidate) => candidate.id === meal.recipeId);
    return (recipe?.ingredients ?? []).map((ingredient) => ({ ingredient, dinner: meal.title }));
  });
  const fromDinners = mergeNeeds(needs).map((need) => ({
    name: need.name,
    ...display(need.quantity, need.unit),
    category: categorize(need.name, need.unit),
    forDinners: need.forDinners,
    extraId: null,
  }));
  const addedByHand = extras.map((extra) => {
    const ingredient = parseIngredient(extra.line);
    const unit = canonicalUnit(ingredient.unit);
    return { ...ingredient, unit, category: categorize(ingredient.name, unit), forDinners: [], extraId: extra.id };
  });
  return [...fromDinners, ...addedByHand].sort(byShopOrder);
}
