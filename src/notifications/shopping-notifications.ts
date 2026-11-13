import type { Household } from "../households/household.js";
import type { PushMessage } from "./push-sender.js";

// Tells the flatmates who are not shopping that now is the moment to add what they need.
export function shoppingStartedMessage(household: Household, shopperMemberId: string) {
  const shopper = household.members.find((member) => member.id === shopperMemberId)?.name ?? "A flatmate";
  return {
    memberIds: household.members.filter((member) => member.id !== shopperMemberId).map((member) => member.id),
    message: {
      title: `${shopper} is shopping`,
      body: "Add what you need to the list now.",
      tag: `shopping-${household.id}`,
    } satisfies PushMessage,
  };
}
