import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { HttpStatus } from "../../src/http-status.js";
import { HouseholdErrorCode } from "../../src/households/household-errors.js";

type App = ReturnType<typeof buildApp>;

interface Session {
  token: string;
  household: {
    id: string;
    name: string;
    inviteCode: string;
    currentMemberId: string;
    members: { id: string; name: string; hasJoined: boolean }[];
  };
}

function authorized(token: string) {
  return { authorization: `Bearer ${token}` };
}

async function createHousehold(app: App): Promise<Session> {
  const response = await app.inject({
    method: "POST",
    url: "/households",
    payload: { name: "Langstrasse 12", memberName: "Mia" },
  });
  return response.json();
}

async function addMember(app: App, token: string, name: string) {
  return app.inject({
    method: "POST",
    url: "/household/members",
    headers: authorized(token),
    payload: { name },
  });
}

describe("household routes", () => {
  let app: App;

  beforeEach(() => {
    app = buildApp();
  });

  afterEach(() => app.close());

  it("creates a household with me as its first member and opens it with my session", async () => {
    const { token, household } = await createHousehold(app);

    const response = await app.inject({ method: "GET", url: "/household", headers: authorized(token) });

    expect(response.statusCode).toBe(HttpStatus.Ok);
    expect(response.json()).toEqual(household);
    expect(household.members).toEqual([
      { id: household.currentMemberId, name: "Mia", hasJoined: true },
    ]);
  });

  it.each([
    ["no session", {}],
    ["an unknown session", authorized("made-up")],
    ["a malformed header", { authorization: "made-up" }],
  ])("refuses access with %s", async (_label, headers) => {
    await createHousehold(app);

    const response = await app.inject({ method: "GET", url: "/household", headers });

    expect(response.statusCode).toBe(HttpStatus.Unauthorized);
    expect(response.json().error).toBe(HouseholdErrorCode.Unauthorized);
  });

  it("rejects a blank or missing name", async () => {
    const blank = await app.inject({
      method: "POST",
      url: "/households",
      payload: { name: "   ", memberName: "Mia" },
    });
    const missing = await app.inject({ method: "POST", url: "/households", payload: { name: "Flat" } });

    expect(blank.statusCode).toBe(HttpStatus.BadRequest);
    expect(blank.json().error).toBe(HouseholdErrorCode.InvalidName);
    expect(missing.statusCode).toBe(HttpStatus.BadRequest);
  });

  it("adds flatmates and rejects duplicates", async () => {
    const { token } = await createHousehold(app);

    const added = await addMember(app, token, "Lea");
    const duplicate = await addMember(app, token, "lea");

    expect(added.statusCode).toBe(HttpStatus.Created);
    expect(added.json().members[1]).toEqual({ id: expect.any(String), name: "Lea", hasJoined: false });
    expect(duplicate.statusCode).toBe(HttpStatus.Conflict);
    expect(duplicate.json().error).toBe(HouseholdErrorCode.DuplicateMember);
  });

  it("removes a flatmate but never myself", async () => {
    const { token, household } = await createHousehold(app);
    const lea = (await addMember(app, token, "Lea")).json().members[1];

    const removeLea = await app.inject({
      method: "DELETE",
      url: `/household/members/${lea.id}`,
      headers: authorized(token),
    });
    const removeMe = await app.inject({
      method: "DELETE",
      url: `/household/members/${household.currentMemberId}`,
      headers: authorized(token),
    });

    expect(removeLea.json().members.map((member: { name: string }) => member.name)).toEqual(["Mia"]);
    expect(removeMe.statusCode).toBe(HttpStatus.Conflict);
    expect(removeMe.json().error).toBe(HouseholdErrorCode.CannotRemoveYourself);
  });

  describe("invites", () => {
    it("shows the household name and the flatmates who have not joined yet", async () => {
      const { token, household } = await createHousehold(app);
      const lea = (await addMember(app, token, "Lea")).json().members[1];

      const response = await app.inject({ method: "GET", url: `/invites/${household.inviteCode}` });

      expect(response.json()).toEqual({
        householdId: household.id,
        householdName: "Langstrasse 12",
        membersToJoin: [{ id: lea.id, name: "Lea" }],
      });
    });

    it("lets me join under a new name and use the household", async () => {
      const { household } = await createHousehold(app);

      const joined = await app.inject({
        method: "POST",
        url: `/invites/${household.inviteCode}/members`,
        payload: { name: "Noah" },
      });
      const { token: noahToken } = joined.json();
      const opened = await app.inject({ method: "GET", url: "/household", headers: authorized(noahToken) });

      expect(joined.statusCode).toBe(HttpStatus.Created);
      expect(opened.json().id).toBe(household.id);
      expect(opened.json().members.map((member: { name: string }) => member.name)).toEqual(["Mia", "Noah"]);
    });

    it("lets me join as a flatmate someone added, but only once", async () => {
      const { token, household } = await createHousehold(app);
      const lea = (await addMember(app, token, "Lea")).json().members[1];
      const joinAsLea = () =>
        app.inject({ method: "POST", url: `/invites/${household.inviteCode}/members/${lea.id}/join` });

      const first = await joinAsLea();
      const second = await joinAsLea();

      expect(first.statusCode).toBe(HttpStatus.Created);
      expect(first.json().household.currentMemberId).toBe(lea.id);
      expect(second.statusCode).toBe(HttpStatus.Conflict);
      expect(second.json().error).toBe(HouseholdErrorCode.MemberAlreadyJoined);
    });

    it("answers 404 for an unknown invite", async () => {
      const response = await app.inject({ method: "GET", url: "/invites/0123456789abcdef0123456789abcdef" });

      expect(response.statusCode).toBe(HttpStatus.NotFound);
      expect(response.json().error).toBe(HouseholdErrorCode.InviteNotFound);
    });
  });

  it("locks out a flatmate after they are removed", async () => {
    const { token, household } = await createHousehold(app);
    const noah = (
      await app.inject({
        method: "POST",
        url: `/invites/${household.inviteCode}/members`,
        payload: { name: "Noah" },
      })
    ).json();

    await app.inject({
      method: "DELETE",
      url: `/household/members/${noah.household.currentMemberId}`,
      headers: authorized(token),
    });
    const response = await app.inject({ method: "GET", url: "/household", headers: authorized(noah.token) });

    expect(response.statusCode).toBe(HttpStatus.Unauthorized);
  });
});
