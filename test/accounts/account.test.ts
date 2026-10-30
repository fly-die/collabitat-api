import { describe, expect, it } from "vitest";
import { AccountErrorCode } from "../../src/accounts/account-errors.js";
import { createAccount, hashPassword, verifyPassword } from "../../src/accounts/account.js";

describe("accounts", () => {
  it("never stores the password itself and recognizes it again", async () => {
    const passwordHash = await hashPassword("correct horse battery");

    expect(passwordHash).not.toContain("correct horse battery");
    expect(await verifyPassword("correct horse battery", passwordHash)).toBe(true);
    expect(await verifyPassword("correct horse batterY", passwordHash)).toBe(false);
  });

  it("salts every hash, so equal passwords look different", async () => {
    expect(await hashPassword("same password")).not.toBe(await hashPassword("same password"));
  });

  it("stores the email trimmed and in lower case", async () => {
    const account = await createAccount({ email: "  Mia@Example.COM ", password: "long enough" });

    expect(account.email).toBe("mia@example.com");
  });

  it.each([
    ["an email without a domain", { email: "mia@", password: "long enough" }, AccountErrorCode.InvalidEmail],
    ["a password under 8 characters", { email: "mia@example.com", password: "short" }, AccountErrorCode.InvalidPassword],
  ])("rejects %s", async (_label, credentials, code) => {
    await expect(createAccount(credentials)).rejects.toMatchObject({ code });
  });
});
