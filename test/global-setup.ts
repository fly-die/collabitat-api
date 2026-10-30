import { connectDatabase } from "../src/db/database.js";

// Migrates once up front, so Postgres test files running in parallel don't race to create tables.
export async function setup() {
  const databaseUrl = process.env.TEST_DATABASE_URL;
  if (databaseUrl) {
    const connection = await connectDatabase(databaseUrl);
    await connection.close();
  }
}
