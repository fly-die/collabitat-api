import { randomUUID } from "node:crypto";
import type { Household } from "../households/household.js";
import { ExpenseError, ExpenseErrorCode } from "./expense-errors.js";
import { validateAmount, validateDate, type Balance, type Settlement } from "./expense.js";

export interface NewSettlement {
  fromMemberId: string;
  toMemberId: string;
  amountCents: number;
  settledOn: string;
}

export interface Transfer {
  fromMemberId: string;
  toMemberId: string;
  amountCents: number;
}

export function createSettlement(household: Household, newSettlement: NewSettlement): Settlement {
  const isMember = (memberId: string) => household.members.some((member) => member.id === memberId);
  if (
    !isMember(newSettlement.fromMemberId) ||
    !isMember(newSettlement.toMemberId) ||
    newSettlement.fromMemberId === newSettlement.toMemberId
  ) {
    throw new ExpenseError(ExpenseErrorCode.InvalidSettlement, "Pick two different flatmates.");
  }
  validateAmount(newSettlement.amountCents);
  validateDate(newSettlement.settledOn);
  return { id: randomUUID(), ...newSettlement, createdAt: new Date().toISOString() };
}

// Pairs the biggest debt with the biggest credit until everything is paid. Every round settles at
// least one person completely, so a household of n people needs at most n - 1 payments.
export function simplifyDebts(balances: Balance[]): Transfer[] {
  const remaining = balances.map((balance) => ({ ...balance }));
  const transfers: Transfer[] = [];
  const largest = (sign: 1 | -1) =>
    remaining.reduce<(typeof remaining)[number] | undefined>(
      (best, candidate) =>
        sign * candidate.balanceCents > 0 && (!best || sign * candidate.balanceCents > sign * best.balanceCents)
          ? candidate
          : best,
      undefined,
    );

  let debtor = largest(-1);
  let creditor = largest(1);
  while (debtor && creditor) {
    const amountCents = Math.min(-debtor.balanceCents, creditor.balanceCents);
    transfers.push({ fromMemberId: debtor.memberId, toMemberId: creditor.memberId, amountCents });
    debtor.balanceCents += amountCents;
    creditor.balanceCents -= amountCents;
    debtor = largest(-1);
    creditor = largest(1);
  }
  return transfers;
}
