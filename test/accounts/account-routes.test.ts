import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AccountErrorCode } from "../../src/accounts/account-errors.js";
import { LOGIN_ATTEMPTS_PER_WINDOW } from "../../src/accounts/account-routes.js";
import { buildApp } from "../../src/app.js";
import { createHousehold } from "../../src/households/household.js";
import { InMemoryHouseholdRepository } from "../../src/households/household-repository.js";
import { HttpStatus } from "../../src/http-status.js";
import { InMemorySessionRepository } from "../../src/sessions/session-repository.js";
import { createSessionToken } from "../../src/sessions/session-token.js";
import { TEST_PASSWORD, newCredentials } from "../support/credentials.js";

type App = ReturnType<typeof buildApp>;

function authorized(token: string) {
  return { authorization: `Bearer ${token}` };
}

describe("account routes", () => {
  let app: App;
  let householdRepository: InMemoryHouseholdRepository;
  let sessionRepository: InMemorySessionRepository;

  beforeEach(() => {
    householdRepository = new InMemoryHouseholdRepository();
    sessionRepository = new InMemorySessionRepository();
    app = buildApp({ householdRepository, sessionRepository });
  });

  afterEach(() => app.close());

  async function createHouseholdAs(credentials: { email: string; password: string }) {
    const response = await app.inject({
      method: "POST",
      url: "/households",
      payload: { name: "Langstrasse 12", memberName: "Mia", ...credentials },
    });
    return response;
  }

  const logIn = (email: string, password: string) =>
    app.inject({ method: "POST", url: "/sessions", payload: { email, password } });

  const openHousehold = (token: string) => app.inject({ url: "/household", headers: authorized(token) });

  it("logs me into my household from anywhere, however I type my email", async () => {
    const credentials = newCredentials("mia");
    const { household } = (await createHouseholdAs(credentials)).json();

    const loggedIn = await logIn(`  ${credentials.email.toUpperCase()} `, credentials.password);
    const opened = await openHousehold(loggedIn.json().token);

    expect(loggedIn.statusCode).toBe(HttpStatus.Created);
    expect(opened.json()).toEqual({ ...household, currentMemberHasAccount: true });
  });

  it("gives the same answer for a wrong password and an unknown email", async () => {
    const credentials = newCredentials("mia");
    await createHouseholdAs(credentials);

    const wrongPassword = await logIn(credentials.email, "not my password");
    const unknownEmail = await logIn("nobody@example.com", TEST_PASSWORD);

    for (const response of [wrongPassword, unknownEmail]) {
      expect(response.statusCode).toBe(HttpStatus.Unauthorized);
      expect(response.json()).toEqual({
        error: AccountErrorCode.WrongCredentials,
        message: "That email and password don't match.",
      });
    }
  });

  it("allows one account per email", async () => {
    const credentials = newCredentials("mia");
    await createHouseholdAs(credentials);

    const second = await createHouseholdAs({ ...credentials, email: credentials.email.toUpperCase() });

    expect(second.statusCode).toBe(HttpStatus.Conflict);
    expect(second.json().error).toBe(AccountErrorCode.EmailTaken);
  });

  it("slows down repeated guesses for one email, but not for others", async () => {
    const credentials = newCredentials("mia");
    await createHouseholdAs(credentials);

    for (let attempt = 0; attempt < LOGIN_ATTEMPTS_PER_WINDOW; attempt += 1) {
      await logIn(credentials.email, "wrong guess");
    }
    const blocked = await logIn(credentials.email, credentials.password);
    const otherEmail = await logIn("lea@example.com", TEST_PASSWORD);

    expect(blocked.statusCode).toBe(HttpStatus.TooManyRequests);
    expect(blocked.json()).toMatchObject({ error: "TOO_MANY_ATTEMPTS", message: "Too many tries. Wait a minute and try again." });
    expect(otherEmail.statusCode).toBe(HttpStatus.Unauthorized);
  });

  it("ends my session when I log out", async () => {
    const { token } = (await createHouseholdAs(newCredentials("mia"))).json();

    const loggedOut = await app.inject({ method: "DELETE", url: "/session", headers: authorized(token) });

    expect(loggedOut.statusCode).toBe(HttpStatus.Ok);
    expect((await openHousehold(token)).statusCode).toBe(HttpStatus.Unauthorized);
  });

  it("lets a flatmate from before accounts add one, once", async () => {
    const { household, member } = createHousehold("Langstrasse 12", "Mia");
    await householdRepository.save(household);
    const { token, tokenHash } = createSessionToken();
    await sessionRepository.create(tokenHash, member.id);
    const credentials = newCredentials("mia");
    const addAccount = () =>
      app.inject({ method: "POST", url: "/household/account", headers: authorized(token), payload: credentials });

    expect((await openHousehold(token)).json().currentMemberHasAccount).toBe(false);
    const added = await addAccount();
    const again = await addAccount();

    expect(added.statusCode).toBe(HttpStatus.Created);
    expect(added.json().currentMemberHasAccount).toBe(true);
    expect(again.json().error).toBe(AccountErrorCode.AccountExists);
    expect((await logIn(credentials.email, credentials.password)).statusCode).toBe(HttpStatus.Created);
  });

  it("explains that a removed flatmate has no household to open", async () => {
    const { token, household } = (await createHouseholdAs(newCredentials("mia"))).json();
    const noahCredentials = newCredentials("noah");
    const noah = (
      await app.inject({
        method: "POST",
        url: `/invites/${household.inviteCode}/members`,
        payload: { name: "Noah", ...noahCredentials },
      })
    ).json();
    await app.inject({
      method: "DELETE",
      url: `/household/members/${noah.household.currentMemberId}`,
      headers: authorized(token),
    });

    const response = await logIn(noahCredentials.email, noahCredentials.password);

    expect(response.statusCode).toBe(HttpStatus.NotFound);
    expect(response.json().error).toBe(AccountErrorCode.NoHousehold);
  });
});
