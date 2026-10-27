import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { HttpStatus } from "../../src/http-status.js";
import { HouseholdErrorCode } from "../../src/households/household-errors.js";

type App = ReturnType<typeof buildApp>;

async function createHousehold(app: App, name = "Langstrasse 12") {
  const response = await app.inject({ method: "POST", url: "/households", payload: { name } });
  return response.json();
}

async function addMember(app: App, householdId: string, name: string) {
  return app.inject({
    method: "POST",
    url: `/households/${householdId}/members`,
    payload: { name },
  });
}

describe("household routes", () => {
  let app: App;

  beforeEach(() => {
    app = buildApp();
  });

  afterEach(() => app.close());

  it("creates a household and reads it back", async () => {
    const created = await createHousehold(app);

    const response = await app.inject({ method: "GET", url: `/households/${created.id}` });

    expect(response.statusCode).toBe(HttpStatus.Ok);
    expect(response.json()).toEqual({ id: created.id, name: "Langstrasse 12", members: [] });
  });

  it("returns 404 for an unknown household", async () => {
    const response = await app.inject({ method: "GET", url: "/households/missing" });

    expect(response.statusCode).toBe(HttpStatus.NotFound);
    expect(response.json().error).toBe(HouseholdErrorCode.HouseholdNotFound);
  });

  it("rejects a request without a name", async () => {
    const response = await app.inject({ method: "POST", url: "/households", payload: {} });

    expect(response.statusCode).toBe(HttpStatus.BadRequest);
  });

  it("rejects a blank name", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/households",
      payload: { name: "   " },
    });

    expect(response.statusCode).toBe(HttpStatus.BadRequest);
    expect(response.json().error).toBe(HouseholdErrorCode.InvalidName);
  });

  it("adds members and rejects duplicates", async () => {
    const household = await createHousehold(app);

    const added = await addMember(app, household.id, "Lea");
    const duplicate = await addMember(app, household.id, "lea");

    expect(added.statusCode).toBe(HttpStatus.Created);
    expect(added.json().members).toEqual([{ id: expect.any(String), name: "Lea" }]);
    expect(duplicate.statusCode).toBe(HttpStatus.Conflict);
    expect(duplicate.json().error).toBe(HouseholdErrorCode.DuplicateMember);
  });

  it("removes a member", async () => {
    const household = await createHousehold(app);
    const lea = (await addMember(app, household.id, "Lea")).json().members[0];

    const response = await app.inject({
      method: "DELETE",
      url: `/households/${household.id}/members/${lea.id}`,
    });

    expect(response.statusCode).toBe(HttpStatus.Ok);
    expect(response.json().members).toEqual([]);
  });

  it("returns 404 when removing an unknown member", async () => {
    const household = await createHousehold(app);

    const response = await app.inject({
      method: "DELETE",
      url: `/households/${household.id}/members/missing`,
    });

    expect(response.statusCode).toBe(HttpStatus.NotFound);
    expect(response.json().error).toBe(HouseholdErrorCode.MemberNotFound);
  });
});
