import { describe, expect, it } from "vitest";
import { addMember, createHousehold } from "../../src/households/household.js";
import { InMemoryHouseholdRepository } from "../../src/households/household-repository.js";

describe("InMemoryHouseholdRepository", () => {
  it("returns undefined for an unknown id", async () => {
    const repository = new InMemoryHouseholdRepository();

    expect(await repository.findById("missing")).toBeUndefined();
  });

  it("stores a household and replaces it on the next save", async () => {
    const repository = new InMemoryHouseholdRepository();
    const household = createHousehold("Flat");

    await repository.save(household);
    await repository.save(addMember(household, "Lea"));

    const stored = await repository.findById(household.id);
    expect(stored?.members.map((member) => member.name)).toEqual(["Lea"]);
  });
});
