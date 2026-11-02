export const LiveTopic = {
  Money: "money",
  Chores: "chores",
  Household: "household",
} as const;

export type LiveTopic = (typeof LiveTopic)[keyof typeof LiveTopic];

type Listener = (topic: LiveTopic) => void;

// Which part of the app a change belongs to, so screens only reload what changed.
export function topicOfPath(url: string): LiveTopic | undefined {
  const path = url.split("?")[0];
  if (path.startsWith("/household/expenses") || path.startsWith("/household/settlements")) {
    return LiveTopic.Money;
  }
  if (path.startsWith("/household/tasks")) {
    return LiveTopic.Chores;
  }
  return path === "/household" || path.startsWith("/household/") ? LiveTopic.Household : undefined;
}

// One process serves the whole app, so the open connections can live in memory.
export class LiveHub {
  private readonly listenersByHouseholdId = new Map<string, Set<Listener>>();

  subscribe(householdId: string, listener: Listener) {
    const listeners = this.listenersByHouseholdId.get(householdId) ?? new Set<Listener>();
    listeners.add(listener);
    this.listenersByHouseholdId.set(householdId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        this.listenersByHouseholdId.delete(householdId);
      }
    };
  }

  publish(householdId: string, topic: LiveTopic) {
    for (const listener of this.listenersByHouseholdId.get(householdId) ?? []) {
      listener(topic);
    }
  }
}
