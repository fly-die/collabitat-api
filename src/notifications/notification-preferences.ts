import { and, eq, inArray } from "drizzle-orm";
import type { Database } from "../db/database.js";
import { notificationMutes } from "../db/schema.js";

// The kinds of notifications a member can switch off on their own.
export const NOTIFICATION_TOPICS = ["chores", "money", "shopping"] as const;
export type NotificationTopic = (typeof NOTIFICATION_TOPICS)[number];
export type NotificationPreferences = Record<NotificationTopic, boolean>;

export interface NotificationPreferenceRepository {
  // Everything is on until a member switches it off.
  find(memberId: string): Promise<NotificationPreferences>;
  save(memberId: string, preferences: NotificationPreferences): Promise<void>;
  // Of these members, the ones who still want this kind.
  listening(memberIds: string[], topic: NotificationTopic): Promise<string[]>;
}

const toPreferences = (muted: readonly string[]) =>
  Object.fromEntries(NOTIFICATION_TOPICS.map((topic) => [topic, !muted.includes(topic)])) as NotificationPreferences;

const mutedTopics = (preferences: NotificationPreferences) => NOTIFICATION_TOPICS.filter((topic) => !preferences[topic]);

export class InMemoryNotificationPreferenceRepository implements NotificationPreferenceRepository {
  private readonly mutedByMember = new Map<string, NotificationTopic[]>();

  async find(memberId: string) {
    return toPreferences(this.mutedByMember.get(memberId) ?? []);
  }

  async save(memberId: string, preferences: NotificationPreferences) {
    this.mutedByMember.set(memberId, mutedTopics(preferences));
  }

  async listening(memberIds: string[], topic: NotificationTopic) {
    return memberIds.filter((memberId) => !this.mutedByMember.get(memberId)?.includes(topic));
  }
}

export class PostgresNotificationPreferenceRepository implements NotificationPreferenceRepository {
  constructor(private readonly database: Database) {}

  async find(memberId: string) {
    const rows = await this.database
      .select({ topic: notificationMutes.topic })
      .from(notificationMutes)
      .where(eq(notificationMutes.memberId, memberId));
    return toPreferences(rows.map((row) => row.topic));
  }

  async save(memberId: string, preferences: NotificationPreferences) {
    const muted = mutedTopics(preferences);
    await this.database.transaction(async (transaction) => {
      await transaction.delete(notificationMutes).where(eq(notificationMutes.memberId, memberId));
      if (muted.length > 0) {
        await transaction.insert(notificationMutes).values(muted.map((topic) => ({ memberId, topic })));
      }
    });
  }

  async listening(memberIds: string[], topic: NotificationTopic) {
    if (memberIds.length === 0) {
      return [];
    }
    const muted = await this.database
      .select({ memberId: notificationMutes.memberId })
      .from(notificationMutes)
      .where(and(inArray(notificationMutes.memberId, memberIds), eq(notificationMutes.topic, topic)));
    const mutedIds = new Set(muted.map((row) => row.memberId));
    return memberIds.filter((memberId) => !mutedIds.has(memberId));
  }
}
