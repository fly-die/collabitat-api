import type { Account } from "./account.js";

export interface AccountRepository {
  findByEmail(email: string): Promise<Account | undefined>;
  createForMember(account: Account, memberId: string): Promise<void>;
  // The member a login opens comes first: the one who joined most recently.
  findMemberIds(accountId: string): Promise<string[]>;
  hasAccount(memberId: string): Promise<boolean>;
}

export class InMemoryAccountRepository implements AccountRepository {
  private readonly accountsByEmail = new Map<string, Account>();
  private readonly accountIdsByMemberId = new Map<string, string>();

  async findByEmail(email: string) {
    return this.accountsByEmail.get(email);
  }

  async createForMember(account: Account, memberId: string) {
    this.accountsByEmail.set(account.email, account);
    this.accountIdsByMemberId.set(memberId, account.id);
  }

  async findMemberIds(accountId: string) {
    return [...this.accountIdsByMemberId]
      .filter(([, linkedAccountId]) => linkedAccountId === accountId)
      .map(([memberId]) => memberId)
      .reverse();
  }

  async hasAccount(memberId: string) {
    return this.accountIdsByMemberId.has(memberId);
  }
}
