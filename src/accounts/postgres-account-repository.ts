import { desc, eq } from "drizzle-orm";
import type { Database } from "../db/database.js";
import { accounts, members } from "../db/schema.js";
import type { Account } from "./account.js";
import type { AccountRepository } from "./account-repository.js";

export class PostgresAccountRepository implements AccountRepository {
  constructor(private readonly database: Database) {}

  async findByEmail(email: string) {
    const [account] = await this.database
      .select({ id: accounts.id, email: accounts.email, passwordHash: accounts.passwordHash })
      .from(accounts)
      .where(eq(accounts.email, email));
    return account;
  }

  async createForMember(account: Account, memberId: string) {
    await this.database.transaction(async (transaction) => {
      await transaction.insert(accounts).values(account);
      await transaction.update(members).set({ accountId: account.id }).where(eq(members.id, memberId));
    });
  }

  async findMemberIds(accountId: string) {
    const linkedMembers = await this.database
      .select({ id: members.id })
      .from(members)
      .where(eq(members.accountId, accountId))
      .orderBy(desc(members.createdAt));
    return linkedMembers.map((member) => member.id);
  }

  async hasAccount(memberId: string) {
    const [member] = await this.database
      .select({ accountId: members.accountId })
      .from(members)
      .where(eq(members.id, memberId));
    return Boolean(member?.accountId);
  }
}
