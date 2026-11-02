import type { Expense } from "../expenses/expense.js";
import type { Household } from "../households/household.js";
import type { PushMessage } from "./push-sender.js";

const CENTS_PER_UNIT = 100;
const amountFormat = new Intl.NumberFormat("de-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// One message per flatmate who shares the expense, except whoever added it.
export function expenseAddedMessages(household: Household, expense: Expense, addedByMemberId: string) {
  const addedBy = household.members.find((member) => member.id === addedByMemberId)?.name ?? "A flatmate";
  return expense.shares
    .filter((share) => share.memberId !== addedByMemberId)
    .map((share) => ({
      memberId: share.memberId,
      message: {
        title: `${addedBy} added ${expense.description}`,
        body: `Your share: ${amountFormat.format(share.amountCents / CENTS_PER_UNIT)}`,
        tag: `expense-${expense.id}`,
      } satisfies PushMessage,
    }));
}
