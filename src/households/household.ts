import { randomUUID } from "node:crypto";
import { HouseholdError, HouseholdErrorCode } from "./household-errors.js";

export const MAX_NAME_LENGTH = 60;
export const MAX_MEMBERS = 20;

export interface Member {
  id: string;
  name: string;
}

export interface Household {
  id: string;
  name: string;
  members: Member[];
}

function normalizeName(rawName: string, label: string): string {
  const name = rawName.trim().replace(/\s+/g, " ");
  if (name.length === 0 || name.length > MAX_NAME_LENGTH) {
    throw new HouseholdError(
      HouseholdErrorCode.InvalidName,
      `${label} must be between 1 and ${MAX_NAME_LENGTH} characters.`,
    );
  }
  return name;
}

export function createHousehold(name: string): Household {
  return { id: randomUUID(), name: normalizeName(name, "Household name"), members: [] };
}

export function addMember(household: Household, rawName: string): Household {
  const name = normalizeName(rawName, "Member name");

  if (household.members.length >= MAX_MEMBERS) {
    throw new HouseholdError(
      HouseholdErrorCode.MemberLimitReached,
      `A household can have at most ${MAX_MEMBERS} members.`,
    );
  }

  const existingMember = household.members.find(
    (member) => member.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
  );
  if (existingMember) {
    throw new HouseholdError(
      HouseholdErrorCode.DuplicateMember,
      `${existingMember.name} is already a member.`,
    );
  }

  return { ...household, members: [...household.members, { id: randomUUID(), name }] };
}

export function removeMember(household: Household, memberId: string): Household {
  const remainingMembers = household.members.filter((member) => member.id !== memberId);
  if (remainingMembers.length === household.members.length) {
    throw new HouseholdError(HouseholdErrorCode.MemberNotFound, "Member not found.");
  }
  return { ...household, members: remainingMembers };
}
