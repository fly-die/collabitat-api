export interface SessionRepository {
  create(tokenHash: string, memberId: string): Promise<void>;
  findMemberId(tokenHash: string): Promise<string | undefined>;
  remove(tokenHash: string): Promise<void>;
}

export class InMemorySessionRepository implements SessionRepository {
  private readonly memberIdsByTokenHash = new Map<string, string>();

  async create(tokenHash: string, memberId: string) {
    this.memberIdsByTokenHash.set(tokenHash, memberId);
  }

  async findMemberId(tokenHash: string) {
    return this.memberIdsByTokenHash.get(tokenHash);
  }

  async remove(tokenHash: string) {
    this.memberIdsByTokenHash.delete(tokenHash);
  }
}
