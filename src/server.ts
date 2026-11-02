import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { WebPushSender } from "./notifications/push-sender.js";
import {
  PostgresPushSubscriptionRepository,
  PostgresReminderLog,
} from "./notifications/postgres-push-subscription-repository.js";
import { connectDatabase } from "./db/database.js";
import { PostgresAccountRepository } from "./accounts/postgres-account-repository.js";
import { PostgresSettlementRepository } from "./expenses/postgres-settlement-repository.js";
import { PostgresExpenseRepository } from "./expenses/postgres-expense-repository.js";
import { PostgresHouseholdRepository } from "./households/postgres-household-repository.js";
import { PostgresSessionRepository } from "./sessions/postgres-session-repository.js";
import { PostgresTaskRepository } from "./tasks/postgres-task-repository.js";

const config = loadConfig();
const database = config.databaseUrl ? await connectDatabase(config.databaseUrl) : undefined;

const app = buildApp({
  householdRepository: database ? new PostgresHouseholdRepository(database.database) : undefined,
  sessionRepository: database ? new PostgresSessionRepository(database.database) : undefined,
  expenseRepository: database ? new PostgresExpenseRepository(database.database) : undefined,
  accountRepository: database ? new PostgresAccountRepository(database.database) : undefined,
  settlementRepository: database ? new PostgresSettlementRepository(database.database) : undefined,
  taskRepository: database ? new PostgresTaskRepository(database.database) : undefined,
  pushSubscriptionRepository: database ? new PostgresPushSubscriptionRepository(database.database) : undefined,
  reminderLog: database ? new PostgresReminderLog(database.database) : undefined,
  pushSender: config.vapidKeys ? new WebPushSender(config.vapidKeys) : undefined,
  sendsChoreReminders: true,
  webOrigins: config.webOrigins,
});

if (!database) {
  app.log.warn("DATABASE_URL is not set. Data is kept in memory and lost on restart.");
}
if (!config.vapidKeys) {
  app.log.warn("VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY are not set. Notifications are off.");
}
if (database) {
  app.addHook("onClose", database.close);
}

try {
  await app.listen({ port: config.port, host: config.host });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
