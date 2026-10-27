const DEFAULT_PORT = 3000;
const DEFAULT_HOST = "0.0.0.0";
const DEFAULT_WEB_ORIGIN = "http://localhost:5173";

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  return {
    port: Number(env.PORT ?? DEFAULT_PORT),
    host: env.HOST ?? DEFAULT_HOST,
    databaseUrl: env.DATABASE_URL,
    webOrigins: (env.WEB_ORIGINS ?? DEFAULT_WEB_ORIGIN).split(",").map((origin) => origin.trim()),
  };
}
