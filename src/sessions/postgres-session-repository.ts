import { eq } from "drizzle-orm";
import type { Database } from "../db/database.js";
import { sessions } from "../db/schema.js";
import type { SessionRepository } from "./session-repository.js";

export class PostgresSessionRepository implements SessionRepository {
  constructor(private readonly database: Database) {}

  async create(tokenHash: string, memberId: string) {
    await this.database.insert(sessions).values({ tokenHash, memberId });
  }

  async findMemberId(tokenHash: string) {
    const [session] = await this.database
      .select({ memberId: sessions.memberId })
      .from(sessions)
      .where(eq(sessions.tokenHash, tokenHash));
    return session?.memberId;
  }
}
