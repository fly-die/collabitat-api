import type { FastifyInstance } from "fastify";
import type { TokenAuthenticator } from "../sessions/authenticate.js";
import type { LiveHub } from "./live-hub.js";

export const LIVE_PATH = "/household/live";
// Browsers can't set headers on a WebSocket, so the session token comes as the first message.
const AUTH_TIMEOUT_MS = 10_000;
// Pings keep phones' and proxies' idle connections from being dropped.
const KEEP_ALIVE_MS = 25_000;
export const CLOSE_UNAUTHORIZED = 4401;

interface LiveRouteDependencies {
  authenticateToken: TokenAuthenticator;
  liveHub: LiveHub;
}

function tokenFrom(message: string) {
  try {
    const { token } = JSON.parse(message) as { token?: unknown };
    return typeof token === "string" ? token : undefined;
  } catch {
    return undefined;
  }
}

export function liveRoutes({ authenticateToken, liveHub }: LiveRouteDependencies) {
  return async function register(app: FastifyInstance) {
    app.get(LIVE_PATH, { websocket: true }, (socket) => {
      let stage: "waiting" | "checking" | "live" = "waiting";
      let unsubscribe: (() => void) | undefined;
      const refuse = () => socket.close(CLOSE_UNAUTHORIZED, "Log in first.");
      const authTimeout = setTimeout(refuse, AUTH_TIMEOUT_MS);
      const keepAlive = setInterval(() => socket.ping(), KEEP_ALIVE_MS);

      socket.on("message", async (data: Buffer) => {
        if (stage !== "waiting") {
          return;
        }
        stage = "checking";
        clearTimeout(authTimeout);
        const token = tokenFrom(data.toString());
        const session = token ? await authenticateToken(token) : undefined;
        if (!session) {
          refuse();
          return;
        }
        stage = "live";
        unsubscribe = liveHub.subscribe(session.household.id, (topic) =>
          socket.send(JSON.stringify({ type: "changed", topic })),
        );
        socket.send(JSON.stringify({ type: "ready" }));
      });

      socket.on("close", () => {
        clearTimeout(authTimeout);
        clearInterval(keepAlive);
        unsubscribe?.();
      });
    });
  };
}
