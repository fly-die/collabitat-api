import { describe, expect, it } from "vitest";
import {
  MAX_MEMBERS,
  MAX_NAME_LENGTH,
  addMember,
  createHousehold,
  joinAsExistingMember,
  joinAsNewMember,
  removeMember,
} from "../../src/households/household.js";
import { HouseholdErrorCode } from "../../src/households/household-errors.js";

function expectErrorCode(action: () => unknown, code: string) {
  expect(action).toThrow(expect.objectContaining({ code }));
}

function newHousehold() {
  return createHousehold("Flat", "Mia");
}

describe("createHousehold", () => {
  it("creates a household with a trimmed name and the creator as joined member", () => {
    const { household, member } = createHousehold("  Langstrasse   12 ", " Mia ");

    expect(household.name).toBe("Langstrasse 12");
    expect(household.members).toEqual([member]);
    expect(member).toEqual({ id: expect.any(String), name: "Mia", hasJoined: true });
  });

  it("gives every household its own hard to guess invite code", () => {
    const first = newHousehold().household.inviteCode;
    const second = newHousehold().household.inviteCode;

    expect(first).toMatch(/^[0-9a-f]{32}$/);
    expect(first).not.toBe(second);
  });

  it.each(["", "   ", "x".repeat(MAX_NAME_LENGTH + 1)])("rejects the name %j", (name) => {
    expectErrorCode(() => createHousehold(name, "Mia"), HouseholdErrorCode.InvalidName);
    expectErrorCode(() => createHousehold("Flat", name), HouseholdErrorCode.InvalidName);
  });
});

describe("addMember", () => {
  it("adds a member who has not joined yet, without changing the original", () => {
    const { household } = newHousehold();
    const updated = addMember(household, "Lea");

    expect(updated.members.map(({ name, hasJoined }) => ({ name, hasJoined }))).toEqual([
      { name: "Mia", hasJoined: true },
      { name: "Lea", hasJoined: false },
    ]);
    expect(household.members).toHaveLength(1);
  });

  it("rejects a name that is already taken, ignoring case", () => {
    const household = addMember(newHousehold().household, "Lea");

    expect(() => addMember(household, " lea ")).toThrow(
      expect.objectContaining({
        code: HouseholdErrorCode.DuplicateMember,
        message: "Lea is already a member.",
      }),
    );
  });

  it("rejects new members once the limit is reached", () => {
    let { household } = newHousehold();
    while (household.members.length < MAX_MEMBERS) {
      household = addMember(household, `Member ${household.members.length}`);
    }

    expectErrorCode(() => addMember(household, "One more"), HouseholdErrorCode.MemberLimitReached);
  });
});

describe("joining", () => {
  it("joins as a new member", () => {
    const { household, member } = joinAsNewMember(newHousehold().household, "Noah");

    expect(member).toEqual({ id: expect.any(String), name: "Noah", hasJoined: true });
    expect(household.members).toContainEqual(member);
  });

  it("joins as a flatmate someone already added", () => {
    const household = addMember(newHousehold().household, "Lea");
    const lea = household.members[1];

    const joined = joinAsExistingMember(household, lea.id);

    expect(joined.member).toEqual({ ...lea, hasJoined: true });
    expect(joined.household.members[1].hasJoined).toBe(true);
  });

  it("does not let anyone take over a member who already joined", () => {
    const { household, member } = newHousehold();

    expectErrorCode(
      () => joinAsExistingMember(household, member.id),
      HouseholdErrorCode.MemberAlreadyJoined,
    );
  });

  it("reports an unknown member", () => {
    expectErrorCode(
      () => joinAsExistingMember(newHousehold().household, "missing"),
      HouseholdErrorCode.MemberNotFound,
    );
  });
});

describe("removeMember", () => {
  it("removes the member with the given id", () => {
    const { household, member: mia } = newHousehold();
    const withLea = addMember(household, "Lea");

    const updated = removeMember(withLea, withLea.members[1].id, mia.id);

    expect(updated.members.map((member) => member.name)).toEqual(["Mia"]);
  });

  it("does not let me remove myself", () => {
    const { household, member } = newHousehold();

    expectErrorCode(
      () => removeMember(household, member.id, member.id),
      HouseholdErrorCode.CannotRemoveYourself,
    );
  });

  it("reports an unknown member", () => {
    const { household, member } = newHousehold();

    expectErrorCode(
      () => removeMember(household, "missing", member.id),
      HouseholdErrorCode.MemberNotFound,
    );
  });
});
