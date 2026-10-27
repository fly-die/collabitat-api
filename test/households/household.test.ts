import { describe, expect, it } from "vitest";
import {
  MAX_MEMBERS,
  MAX_NAME_LENGTH,
  addMember,
  createHousehold,
  removeMember,
} from "../../src/households/household.js";
import { HouseholdErrorCode } from "../../src/households/household-errors.js";

function expectErrorCode(action: () => unknown, code: string) {
  expect(action).toThrow(expect.objectContaining({ code }));
}

describe("createHousehold", () => {
  it("creates an empty household with a trimmed name", () => {
    const household = createHousehold("  Langstrasse   12 ");

    expect(household.name).toBe("Langstrasse 12");
    expect(household.members).toEqual([]);
    expect(household.id).toEqual(expect.any(String));
  });

  it.each(["", "   ", "x".repeat(MAX_NAME_LENGTH + 1)])("rejects the name %j", (name) => {
    expectErrorCode(() => createHousehold(name), HouseholdErrorCode.InvalidName);
  });
});

describe("addMember", () => {
  it("adds a member without changing the original household", () => {
    const household = createHousehold("Flat");
    const updated = addMember(household, "Lea");

    expect(updated.members.map((member) => member.name)).toEqual(["Lea"]);
    expect(household.members).toEqual([]);
  });

  it("rejects a name that is already taken, ignoring case", () => {
    const household = addMember(createHousehold("Flat"), "Lea");

    expect(() => addMember(household, " lea ")).toThrow(
      expect.objectContaining({
        code: HouseholdErrorCode.DuplicateMember,
        message: "Lea is already a member.",
      }),
    );
  });

  it("rejects new members once the limit is reached", () => {
    let household = createHousehold("Flat");
    for (let index = 0; index < MAX_MEMBERS; index++) {
      household = addMember(household, `Member ${index}`);
    }

    expectErrorCode(() => addMember(household, "One more"), HouseholdErrorCode.MemberLimitReached);
  });
});

describe("removeMember", () => {
  it("removes the member with the given id", () => {
    const household = addMember(addMember(createHousehold("Flat"), "Lea"), "Noah");
    const [lea] = household.members;

    expect(removeMember(household, lea.id).members.map((member) => member.name)).toEqual(["Noah"]);
  });

  it("reports an unknown member", () => {
    expectErrorCode(
      () => removeMember(createHousehold("Flat"), "missing"),
      HouseholdErrorCode.MemberNotFound,
    );
  });
});
