import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as schema from "./schema.js";

const MIGRATIONS_FOLDER = "./drizzle";

export async function connectDatabase(databaseUrl: string) {
  const client = postgres(databaseUrl);
  const database = drizzle(client, { schema });
  await migrate(database, { migrationsFolder: MIGRATIONS_FOLDER });
  return { database, close: () => client.end() };
}

export type Database = Awaited<ReturnType<typeof connectDatabase>>["database"];
