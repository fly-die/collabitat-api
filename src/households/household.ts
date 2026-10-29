import { randomBytes, randomUUID } from "node:crypto";
import { HouseholdError, HouseholdErrorCode } from "./household-errors.js";

export const MAX_NAME_LENGTH = 60;
export const MAX_MEMBERS = 20;
const INVITE_CODE_BYTES = 16;

export interface Member {
  id: string;
  name: string;
  // False for flatmates someone added by name who have not opened the invite link yet.
  hasJoined: boolean;
}

export interface Household {
  id: string;
  name: string;
  inviteCode: string;
  members: Member[];
}

export interface HouseholdWithMember {
  household: Household;
  member: Member;
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

function appendMember(household: Household, rawName: string, hasJoined: boolean): HouseholdWithMember {
  const name = normalizeName(rawName, "Name");

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

  const member = { id: randomUUID(), name, hasJoined };
  return { household: { ...household, members: [...household.members, member] }, member };
}

export function createHousehold(name: string, creatorName: string): HouseholdWithMember {
  const household = {
    id: randomUUID(),
    name: normalizeName(name, "Household name"),
    inviteCode: randomBytes(INVITE_CODE_BYTES).toString("hex"),
    members: [],
  };
  return appendMember(household, creatorName, true);
}

export function addMember(household: Household, name: string): Household {
  return appendMember(household, name, false).household;
}

export function joinAsNewMember(household: Household, name: string): HouseholdWithMember {
  return appendMember(household, name, true);
}

export function joinAsExistingMember(household: Household, memberId: string): HouseholdWithMember {
  const member = household.members.find((candidate) => candidate.id === memberId);
  if (!member) {
    throw new HouseholdError(HouseholdErrorCode.MemberNotFound, "Member not found.");
  }
  if (member.hasJoined) {
    throw new HouseholdError(
      HouseholdErrorCode.MemberAlreadyJoined,
      `${member.name} has already joined. Pick another name.`,
    );
  }

  const joinedMember = { ...member, hasJoined: true };
  return {
    household: {
      ...household,
      members: household.members.map((candidate) =>
        candidate.id === memberId ? joinedMember : candidate,
      ),
    },
    member: joinedMember,
  };
}

export function removeMember(household: Household, memberId: string, currentMemberId: string): Household {
  if (memberId === currentMemberId) {
    throw new HouseholdError(HouseholdErrorCode.CannotRemoveYourself, "You can't remove yourself.");
  }
  const remainingMembers = household.members.filter((member) => member.id !== memberId);
  if (remainingMembers.length === household.members.length) {
    throw new HouseholdError(HouseholdErrorCode.MemberNotFound, "Member not found.");
  }
  return { ...household, members: remainingMembers };
}
