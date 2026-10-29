import { describe, expect, it } from "vitest";
import { addMember, createHousehold } from "../../src/households/household.js";
import { InMemoryHouseholdRepository } from "../../src/households/household-repository.js";

describe("InMemoryHouseholdRepository", () => {
  it("finds a saved household by invite code and by any of its members", async () => {
    const repository = new InMemoryHouseholdRepository();
    const { household } = createHousehold("Flat", "Mia");
    const withLea = addMember(household, "Lea");
    await repository.save(withLea);

    expect(await repository.findByInviteCode(household.inviteCode)).toEqual(withLea);
    expect(await repository.findByMemberId(withLea.members[1].id)).toEqual(withLea);
  });

  it("returns undefined for unknown codes and members", async () => {
    const repository = new InMemoryHouseholdRepository();

    expect(await repository.findByInviteCode("missing")).toBeUndefined();
    expect(await repository.findByMemberId("missing")).toBeUndefined();
  });
});
