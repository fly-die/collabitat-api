import { sql } from "drizzle-orm";
import {
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const households = pgTable(
  "households",
  {
    id: uuid("id").primaryKey(),
    name: text("name").notNull(),
    inviteCode: text("invite_code").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("households_invite_code_unique").on(table.inviteCode)],
);

// Emails are stored normalized (trimmed, lower case), so the unique index covers every spelling.
export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").primaryKey(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("accounts_email_unique").on(table.email)],
);

export const members = pgTable(
  "members",
  {
    id: uuid("id").primaryKey(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    joinedAt: timestamp("joined_at", { withTimezone: true }),
    accountId: uuid("account_id").references(() => accounts.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("members_household_id_idx").on(table.householdId),
    index("members_account_id_idx").on(table.accountId),
    uniqueIndex("members_household_name_unique").on(table.householdId, sql`lower(${table.name})`),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("sessions_member_id_idx").on(table.memberId)],
);

export const expenses = pgTable(
  "expenses",
  {
    id: uuid("id").primaryKey(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    description: text("description").notNull(),
    amountCents: integer("amount_cents").notNull(),
    // No cascade: a member who is part of an expense stays in the household.
    paidByMemberId: uuid("paid_by_member_id")
      .notNull()
      .references(() => members.id),
    spentOn: date("spent_on", { mode: "string" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("expenses_household_id_idx").on(table.householdId)],
);

export const expenseShares = pgTable(
  "expense_shares",
  {
    expenseId: uuid("expense_id")
      .notNull()
      .references(() => expenses.id, { onDelete: "cascade" }),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id),
    amountCents: integer("amount_cents").notNull(),
  },
  (table) => [primaryKey({ columns: [table.expenseId, table.memberId] })],
);

export const settlements = pgTable(
  "settlements",
  {
    id: uuid("id").primaryKey(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    // No cascade: a member who paid or got paid stays in the household.
    fromMemberId: uuid("from_member_id")
      .notNull()
      .references(() => members.id),
    toMemberId: uuid("to_member_id")
      .notNull()
      .references(() => members.id),
    amountCents: integer("amount_cents").notNull(),
    settledOn: date("settled_on", { mode: "string" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("settlements_household_id_idx").on(table.householdId)],
);
