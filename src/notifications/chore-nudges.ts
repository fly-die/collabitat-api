import type { Household } from "../households/household.js";
import type { RecurringTask } from "../tasks/recurring-task.js";
import type { PushMessage } from "./push-sender.js";

// What a flatmate gets when someone reminds them of a chore that is their turn.
export function choreNudge(household: Household, task: RecurringTask, fromMemberId: string): PushMessage {
  const from = household.members.find((member) => member.id === fromMemberId)?.name ?? "A flatmate";
  return {
    title: `${from} nudged you`,
    body: `${task.title} is your turn.`,
    tag: `nudge-${task.id}`,
  };
}
