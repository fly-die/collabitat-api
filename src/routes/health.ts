import type { FastifyInstance } from "fastify";

export const HEALTH_PATH = "/health";

export async function healthRoutes(app: FastifyInstance) {
  app.get(HEALTH_PATH, async () => ({ status: "ok" }));
}
