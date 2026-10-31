import { randomUUID } from "node:crypto";
import type { Household, Member } from "../households/household.js";
import { ExpenseError, ExpenseErrorCode } from "./expense-errors.js";

export const MAX_DESCRIPTION_LENGTH = 80;
export const MAX_AMOUNT_CENTS = 10_000_000;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export interface ExpenseShare {
  memberId: string;
  amountCents: number;
}

export interface Expense {
  id: string;
  description: string;
  amountCents: number;
  paidByMemberId: string;
  // A calendar day (YYYY-MM-DD), so it reads the same in every time zone.
  spentOn: string;
  shares: ExpenseShare[];
  // When it was added (ISO timestamp), so entries of the same day keep their order.
  createdAt: string;
}

export interface NewExpense {
  description: string;
  amountCents: number;
  paidByMemberId: string;
  splitBetweenMemberIds: string[];
  spentOn: string;
}

export interface Balance {
  memberId: string;
  // Positive: the household owes this member. Negative: this member owes the household.
  balanceCents: number;
}

function normalizeDescription(rawDescription: string) {
  const description = rawDescription.trim().replace(/\s+/g, " ");
  if (description.length === 0 || description.length > MAX_DESCRIPTION_LENGTH) {
    throw new ExpenseError(
      ExpenseErrorCode.InvalidDescription,
      `Say what it was for in 1 to ${MAX_DESCRIPTION_LENGTH} characters.`,
    );
  }
  return description;
}

export function validateAmount(amountCents: number) {
  if (!Number.isInteger(amountCents) || amountCents <= 0 || amountCents > MAX_AMOUNT_CENTS) {
    throw new ExpenseError(
      ExpenseErrorCode.InvalidAmount,
      `Enter an amount between 0.01 and ${MAX_AMOUNT_CENTS / 100}.`,
    );
  }
}

export function validateDate(spentOn: string) {
  const date = new Date(`${spentOn}T00:00:00Z`);
  if (!ISO_DATE_PATTERN.test(spentOn) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== spentOn) {
    throw new ExpenseError(ExpenseErrorCode.InvalidDate, "Pick a valid date.");
  }
}

function membersToSplitBetween(household: Household, memberIds: string[]): Member[] {
  const uniqueIds = new Set(memberIds);
  // Household order keeps the split stable no matter how the request lists the members.
  const participants = household.members.filter((member) => uniqueIds.has(member.id));
  if (participants.length === 0 || participants.length !== uniqueIds.size) {
    throw new ExpenseError(ExpenseErrorCode.InvalidSplit, "Pick at least one flatmate to split with.");
  }
  return participants;
}

// Cents that don't divide evenly go one each to the first members, so the shares add up exactly.
export function splitEqually(amountCents: number, memberIds: string[]): ExpenseShare[] {
  const baseShare = Math.floor(amountCents / memberIds.length);
  const remainder = amountCents % memberIds.length;
  return memberIds.map((memberId, index) => ({
    memberId,
    amountCents: baseShare + (index < remainder ? 1 : 0),
  }));
}

export function createExpense(household: Household, newExpense: NewExpense): Expense {
  const description = normalizeDescription(newExpense.description);
  validateAmount(newExpense.amountCents);
  validateDate(newExpense.spentOn);
  if (!household.members.some((member) => member.id === newExpense.paidByMemberId)) {
    throw new ExpenseError(ExpenseErrorCode.UnknownPayer, "The person who paid isn't in this household.");
  }
  const participants = membersToSplitBetween(household, newExpense.splitBetweenMemberIds);

  return {
    id: randomUUID(),
    description,
    amountCents: newExpense.amountCents,
    paidByMemberId: newExpense.paidByMemberId,
    spentOn: newExpense.spentOn,
    shares: splitEqually(
      newExpense.amountCents,
      participants.map((member) => member.id),
    ),
    createdAt: new Date().toISOString(),
  };
}

// A payment from one flatmate to another, recorded when they settle up.
export interface Settlement {
  id: string;
  fromMemberId: string;
  toMemberId: string;
  amountCents: number;
  settledOn: string;
  createdAt: string;
}

export function calculateBalances(
  members: Member[],
  expenses: Expense[],
  settlements: Settlement[] = [],
): Balance[] {
  const balanceByMemberId = new Map(members.map((member) => [member.id, 0]));
  const adjust = (memberId: string, cents: number) =>
    balanceByMemberId.set(memberId, (balanceByMemberId.get(memberId) ?? 0) + cents);

  for (const expense of expenses) {
    adjust(expense.paidByMemberId, expense.amountCents);
    for (const share of expense.shares) {
      adjust(share.memberId, -share.amountCents);
    }
  }
  for (const settlement of settlements) {
    adjust(settlement.fromMemberId, settlement.amountCents);
    adjust(settlement.toMemberId, -settlement.amountCents);
  }
  return members.map((member) => ({
    memberId: member.id,
    balanceCents: balanceByMemberId.get(member.id) ?? 0,
  }));
}

export function involvesMember(expense: Expense, memberId: string) {
  return (
    expense.paidByMemberId === memberId || expense.shares.some((share) => share.memberId === memberId)
  );
}
