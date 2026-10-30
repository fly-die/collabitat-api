import { AccountError, AccountErrorCode } from "./account-errors.js";
import type { AccountRepository } from "./account-repository.js";
import { createAccount, hashPassword, normalizeEmail, verifyPassword, type Credentials } from "./account.js";

export function accountService(accountRepository: AccountRepository) {
  async function prepare(credentials: Credentials) {
    const account = await createAccount(credentials);
    if (await accountRepository.findByEmail(account.email)) {
      throw new AccountError(
        AccountErrorCode.EmailTaken,
        "There's already an account with this email. Log in instead.",
      );
    }
    return account;
  }

  async function findAccount(email: string) {
    try {
      return await accountRepository.findByEmail(normalizeEmail(email));
    } catch {
      return undefined;
    }
  }

  async function logIn({ email, password }: Credentials) {
    const wrongCredentials = new AccountError(
      AccountErrorCode.WrongCredentials,
      "That email and password don't match.",
    );
    const account = await findAccount(email);
    if (!account) {
      // Hashing anyway keeps an unknown email as slow as a wrong password.
      await hashPassword(password);
      throw wrongCredentials;
    }
    if (!(await verifyPassword(password, account.passwordHash))) {
      throw wrongCredentials;
    }
    return account;
  }

  return { prepare, logIn };
}

export type AccountService = ReturnType<typeof accountService>;
