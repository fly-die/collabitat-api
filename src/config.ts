const DEFAULT_PORT = 3000;
const DEFAULT_HOST = "0.0.0.0";
const DEFAULT_WEB_ORIGIN = "http://localhost:5173";
// Push services want a way to reach whoever runs the server; the app's page will do.
const DEFAULT_VAPID_SUBJECT = "https://fly-die.github.io/collabitat-web/";

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  return {
    port: Number(env.PORT ?? DEFAULT_PORT),
    host: env.HOST ?? DEFAULT_HOST,
    databaseUrl: env.DATABASE_URL,
    webOrigins: (env.WEB_ORIGINS ?? DEFAULT_WEB_ORIGIN).split(",").map((origin) => origin.trim()),
    // Both keys or none: notifications stay off until the server has them.
    vapidKeys:
      env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY
        ? {
            publicKey: env.VAPID_PUBLIC_KEY,
            privateKey: env.VAPID_PRIVATE_KEY,
            subject: env.VAPID_SUBJECT || DEFAULT_VAPID_SUBJECT,
          }
        : undefined,
  };
}
