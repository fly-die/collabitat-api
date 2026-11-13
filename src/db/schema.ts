import { sql } from "drizzle-orm";
import {
  date,
  index,
  integer,
  jsonb,
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
    currency: text("currency").notNull().default("CHF"),
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

export const recurringTasks = pgTable(
  "recurring_tasks",
  {
    id: uuid("id").primaryKey(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    intervalCount: integer("interval_count").notNull(),
    intervalUnit: text("interval_unit").notNull(),
    firstDueOn: date("first_due_on", { mode: "string" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("recurring_tasks_household_id_idx").on(table.householdId)],
);

export const taskCompletions = pgTable(
  "task_completions",
  {
    id: uuid("id").primaryKey(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => recurringTasks.id, { onDelete: "cascade" }),
    // Set to null when the member leaves, so the history keeps the date.
    memberId: uuid("member_id").references(() => members.id, { onDelete: "set null" }),
    doneOn: date("done_on", { mode: "string" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("task_completions_task_id_idx").on(table.taskId)],
);

// Who takes turns on a task, in order; leaving the household drops a member out.
export const taskRotations = pgTable(
  "task_rotations",
  {
    taskId: uuid("task_id")
      .notNull()
      .references(() => recurringTasks.id, { onDelete: "cascade" }),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
  },
  (table) => [primaryKey({ columns: [table.taskId, table.memberId] })],
);

// One row per device that turned notifications on; leaving the household removes them.
export const pushSubscriptions = pgTable("push_subscriptions", {
  endpoint: text("endpoint").primaryKey(),
  memberId: uuid("member_id")
    .notNull()
    .references(() => members.id, { onDelete: "cascade" }),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// The kinds of notifications a member switched off; no row means the kind is on.
export const notificationMutes = pgTable(
  "notification_mutes",
  {
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    topic: text("topic").notNull(),
  },
  (table) => [primaryKey({ columns: [table.memberId, table.topic] })],
);

// Who already got the chore reminder on which day, so it goes out once even across restarts.
export const choreRemindersSent = pgTable(
  "chore_reminders_sent",
  {
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    sentOn: date("sent_on", { mode: "string" }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.memberId, table.sentOn] })],
);

export const recipes = pgTable(
  "recipes",
  {
    id: uuid("id").primaryKey(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    servings: integer("servings").notNull(),
    // Parsed lines ({ quantity, unit, name }); the shopping list reads them, nothing queries inside.
    ingredients: jsonb("ingredients").$type<{ quantity: number | null; unit: string | null; name: string }[]>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("recipes_household_id_idx").on(table.householdId)],
);

// One dinner per household and day; it keeps its title when the recipe or the cook goes.
export const plannedMeals = pgTable(
  "planned_meals",
  {
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    date: date("date", { mode: "string" }).notNull(),
    // breakfast, lunch or dinner; meals planned before there was a choice were dinners.
    slot: text("slot").notNull().default("dinner"),
    title: text("title").notNull(),
    recipeId: uuid("recipe_id").references(() => recipes.id, { onDelete: "set null" }),
    cookMemberId: uuid("cook_member_id").references(() => members.id, { onDelete: "set null" }),
    // How many eat; null means the recipe's own servings.
    servings: integer("servings"),
  },
  (table) => [primaryKey({ columns: [table.householdId, table.date, table.slot] })],
);

// The weekdays a household also plans breakfast or lunch on (1 = Monday, 7 = Sunday).
export const mealTimes = pgTable(
  "meal_times",
  {
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    slot: text("slot").notNull(),
    weekday: integer("weekday").notNull(),
  },
  (table) => [primaryKey({ columns: [table.householdId, table.slot, table.weekday] })],
);

// Items added to the shopping list by hand, as typed ("2 l milk").
export const shoppingItems = pgTable(
  "shopping_items",
  {
    id: uuid("id").primaryKey(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    line: text("line").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // The recipe the item came from, if it was put on the list with one.
    recipeTitle: text("recipe_title"),
  },
  (table) => [index("shopping_items_household_id_idx").on(table.householdId)],
);

// Someone is at the shop with the list of one week; at most one trip per household.
export const shoppingTrips = pgTable("shopping_trips", {
  householdId: uuid("household_id")
    .primaryKey()
    .references(() => households.id, { onDelete: "cascade" }),
  shopperMemberId: uuid("shopper_member_id")
    .notNull()
    .references(() => members.id, { onDelete: "cascade" }),
  weekFrom: date("week_from", { mode: "string" }).notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
});

// Ticked items on a week's list, by item key, so they stay ticked while the list is rebuilt.
export const shoppingChecks = pgTable(
  "shopping_checks",
  {
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    weekFrom: date("week_from", { mode: "string" }).notNull(),
    itemKey: text("item_key").notNull(),
  },
  (table) => [primaryKey({ columns: [table.householdId, table.weekFrom, table.itemKey] })],
);

// A person or group in the shared calendar; not necessarily someone with an account.
export const calendarColumns = pgTable(
  "calendar_columns",
  {
    id: uuid("id").primaryKey(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("calendar_columns_household_id_idx").on(table.householdId)],
);

// An important date; removing its column moves it to everyone.
export const calendarEntries = pgTable(
  "calendar_entries",
  {
    id: uuid("id").primaryKey(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    day: date("day", { mode: "string" }).notNull(),
    time: text("time"),
    columnId: uuid("column_id").references(() => calendarColumns.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("calendar_entries_household_id_day_idx").on(table.householdId, table.day)],
);

// Quick notes shared by the household; a done note is a ticked-off todo.
export const notes = pgTable(
  "notes",
  {
    id: uuid("id").primaryKey(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    authorMemberId: uuid("author_member_id").references(() => members.id, { onDelete: "set null" }),
    doneAt: timestamp("done_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("notes_household_id_idx").on(table.householdId)],
);
