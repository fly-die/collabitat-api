export interface SessionRepository {
  create(tokenHash: string, memberId: string): Promise<void>;
  findMemberId(tokenHash: string): Promise<string | undefined>;
}

export class InMemorySessionRepository implements SessionRepository {
  private readonly memberIdsByTokenHash = new Map<string, string>();

  async create(tokenHash: string, memberId: string) {
    this.memberIdsByTokenHash.set(tokenHash, memberId);
  }

  async findMemberId(tokenHash: string) {
    return this.memberIdsByTokenHash.get(tokenHash);
  }
}
