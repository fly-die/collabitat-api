export const LiveTopic = {
  Money: "money",
  Chores: "chores",
  Household: "household",
  Meals: "meals",
  Calendar: "calendar",
} as const;

export type LiveTopic = (typeof LiveTopic)[keyof typeof LiveTopic];

type Listener = (topic: LiveTopic) => void;

const CHECKOUT_PATH = "/household/shopping-trip/checkout";

// Which parts of the app a change belongs to, so screens only reload what changed.
export function topicsOfPath(url: string): LiveTopic[] {
  const path = url.split("?")[0];
  // A device turning notifications on or off changes nothing anyone else sees.
  if (path.startsWith("/household/push-subscription")) {
    return [];
  }
  if (path.startsWith("/household/expenses") || path.startsWith("/household/settlements")) {
    return [LiveTopic.Money];
  }
  if (path.startsWith("/household/tasks")) {
    return [LiveTopic.Chores];
  }
  if (path.startsWith("/household/calendar")) {
    return [LiveTopic.Calendar];
  }
  // Checking out ends the trip and adds the groceries to the money.
  if (path === CHECKOUT_PATH) {
    return [LiveTopic.Meals, LiveTopic.Money];
  }
  if (["/household/meals", "/household/recipes", "/household/shopping-"].some((prefix) => path.startsWith(prefix))) {
    return [LiveTopic.Meals];
  }
  return path === "/household" || path.startsWith("/household/") ? [LiveTopic.Household] : [];
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
