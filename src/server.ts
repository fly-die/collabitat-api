import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { connectDatabase } from "./db/database.js";
import { PostgresHouseholdRepository } from "./households/postgres-household-repository.js";
import { PostgresSessionRepository } from "./sessions/postgres-session-repository.js";

const config = loadConfig();
const database = config.databaseUrl ? await connectDatabase(config.databaseUrl) : undefined;

const app = buildApp({
  householdRepository: database ? new PostgresHouseholdRepository(database.database) : undefined,
  sessionRepository: database ? new PostgresSessionRepository(database.database) : undefined,
  webOrigins: config.webOrigins,
});

if (!database) {
  app.log.warn("DATABASE_URL is not set. Data is kept in memory and lost on restart.");
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
