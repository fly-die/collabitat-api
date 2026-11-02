import type { PushSubscription, StoredPushSubscription } from "./push-subscription.js";

export interface PushSubscriptionRepository {
  // One row per device: saving the same endpoint again updates its keys and owner.
  save(memberId: string, subscription: PushSubscription): Promise<void>;
  // Only removes the member's own device; returns false when it wasn't theirs or is gone.
  remove(memberId: string, endpoint: string): Promise<boolean>;
  // For subscriptions the push service says no longer exist.
  forget(endpoint: string): Promise<void>;
  listByMembers(memberIds: string[]): Promise<StoredPushSubscription[]>;
  listAll(): Promise<StoredPushSubscription[]>;
}

// Remembers which members already got today's chore reminder, so restarts never send it twice.
export interface ReminderLog {
  // True the first time for this member and day, false after that.
  claim(memberId: string, day: string): Promise<boolean>;
}

export class InMemoryPushSubscriptionRepository implements PushSubscriptionRepository {
  private readonly byEndpoint = new Map<string, StoredPushSubscription>();

  async save(memberId: string, subscription: PushSubscription) {
    this.byEndpoint.set(subscription.endpoint, { ...subscription, memberId });
  }

  async remove(memberId: string, endpoint: string) {
    if (this.byEndpoint.get(endpoint)?.memberId !== memberId) {
      return false;
    }
    return this.byEndpoint.delete(endpoint);
  }

  async forget(endpoint: string) {
    this.byEndpoint.delete(endpoint);
  }

  async listByMembers(memberIds: string[]) {
    return [...this.byEndpoint.values()].filter((subscription) => memberIds.includes(subscription.memberId));
  }

  async listAll() {
    return [...this.byEndpoint.values()];
  }
}

export class InMemoryReminderLog implements ReminderLog {
  private readonly claimed = new Set<string>();

  async claim(memberId: string, day: string) {
    const key = `${memberId}:${day}`;
    if (this.claimed.has(key)) {
      return false;
    }
    this.claimed.add(key);
    return true;
  }
}
