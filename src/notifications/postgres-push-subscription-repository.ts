import { and, eq, inArray } from "drizzle-orm";
import type { Database } from "../db/database.js";
import { choreRemindersSent, pushSubscriptions } from "../db/schema.js";
import type { PushSubscription } from "./push-subscription.js";
import type { PushSubscriptionRepository, ReminderLog } from "./push-subscription-repository.js";

type Row = typeof pushSubscriptions.$inferSelect;

const toSubscription = ({ endpoint, memberId, p256dh, auth }: Row) => ({ endpoint, memberId, keys: { p256dh, auth } });

export class PostgresPushSubscriptionRepository implements PushSubscriptionRepository {
  constructor(private readonly database: Database) {}

  async save(memberId: string, { endpoint, keys }: PushSubscription) {
    await this.database
      .insert(pushSubscriptions)
      .values({ endpoint, memberId, p256dh: keys.p256dh, auth: keys.auth })
      .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: { memberId, p256dh: keys.p256dh, auth: keys.auth } });
  }

  async remove(memberId: string, endpoint: string) {
    const removed = await this.database
      .delete(pushSubscriptions)
      .where(and(eq(pushSubscriptions.endpoint, endpoint), eq(pushSubscriptions.memberId, memberId)))
      .returning({ endpoint: pushSubscriptions.endpoint });
    return removed.length > 0;
  }

  async forget(endpoint: string) {
    await this.database.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
  }

  async listByMembers(memberIds: string[]) {
    if (memberIds.length === 0) {
      return [];
    }
    const rows = await this.database.select().from(pushSubscriptions).where(inArray(pushSubscriptions.memberId, memberIds));
    return rows.map(toSubscription);
  }

  async listAll() {
    return (await this.database.select().from(pushSubscriptions)).map(toSubscription);
  }
}

export class PostgresReminderLog implements ReminderLog {
  constructor(private readonly database: Database) {}

  async claim(memberId: string, day: string) {
    const claimed = await this.database
      .insert(choreRemindersSent)
      .values({ memberId, sentOn: day })
      .onConflictDoNothing()
      .returning({ memberId: choreRemindersSent.memberId });
    return claimed.length > 0;
  }
}
