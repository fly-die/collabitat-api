import { describe, expect, it } from "vitest";
import { readRecipe } from "../../src/meals/recipe-import.js";

const page = (head: string, body = "") => `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;
const jsonLd = (data: unknown) => `<script type="application/ld+json">${JSON.stringify(data)}</script>`;

describe("recipe import", () => {
  it("reads a recipe from JSON-LD, also inside a @graph, and cleans up its text", () => {
    const html = page(
      jsonLd({ "@context": "https://schema.org", "@type": "WebSite", name: "Kochseite" }) +
        jsonLd({
          "@context": "https://schema.org",
          "@graph": [
            { "@type": "WebPage", name: "Page" },
            {
              "@type": ["Recipe", "Thing"],
              name: "Pasta &amp; Tomaten",
              recipeYield: ["6", "6 Portionen"],
              recipeIngredient: ["500  g <b>Spaghetti</b>", "2 Dosen Tomaten", " ", "Salz &#38; Pfeffer"],
            },
          ],
        }),
    );

    expect(readRecipe(html)).toEqual({
      title: "Pasta & Tomaten",
      servings: 6,
      ingredientLines: ["500 g Spaghetti", "2 Dosen Tomaten", "Salz & Pfeffer"],
    });
  });

  it("reads a recipe from microdata, skipping the author's name", () => {
    const html = page(
      "",
      `<article itemscope itemtype="http://schema.org/Recipe">
        <div itemprop="author" itemscope itemtype="http://schema.org/Person"><span itemprop="name">Swissmilk</span></div>
        <span itemprop="name">Älplermagronen</span>
        <div itemprop="recipeYield">4 Personen</div>
        <table>
          <tr itemprop="recipeIngredient"><td><span>600</span><span> g</span></td><th>Kartoffeln</th></tr>
          <tr itemprop="recipeIngredient"><td>2 dl</td><th>Rahm</th></tr>
        </table>
      </article>`,
    );

    expect(readRecipe(html)).toEqual({ title: "Älplermagronen", servings: 4, ingredientLines: ["600 g Kartoffeln", "2 dl Rahm"] });
  });

  it("reads numeric entities and yields, and skips a recipe without a name for the next one", () => {
    const nameless = jsonLd({ "@type": "Recipe", name: " ", recipeIngredient: ["Salt"] });
    const recipe = jsonLd({ "@type": "Recipe", name: "Caf&#xE9; &#233;clair &unknown;", recipeYield: 12 });

    expect(readRecipe(page(nameless + recipe))).toEqual({ title: "Café éclair &unknown;", servings: 12, ingredientLines: [] });
  });

  it("stops looking for a recipe buried too deep", () => {
    let deep: unknown = { "@type": "Recipe", name: "Hidden" };
    for (let level = 0; level < 10; level += 1) {
      deep = { child: deep };
    }

    expect(readRecipe(page(jsonLd(deep)))).toBeUndefined();
  });

  it("skips microdata without a recipe name, and other microdata types", () => {
    const withoutName = '<div itemscope itemtype="https://schema.org/Recipe"><span itemprop="recipeIngredient">Salt</span></div>';
    const otherType = '<div itemscope itemtype="https://schema.org/Person"><span itemprop="name">Lea</span></div>';

    expect(readRecipe(page("", withoutName))).toBeUndefined();
    expect(readRecipe(page("", otherType))).toBeUndefined();
  });

  it("falls back to 4 servings, and skips broken data and pages without a recipe", () => {
    const broken = '<script type="application/ld+json">{ not json</script>';
    const recipe = jsonLd({ "@type": "Recipe", name: "Soup", recipeYield: "a big pot" });

    expect(readRecipe(page(broken + recipe))).toEqual({ title: "Soup", servings: 4, ingredientLines: [] });
    expect(readRecipe(page(jsonLd({ "@type": "Article", name: "News" }), "<p>No recipe here</p>"))).toBeUndefined();
  });
});
