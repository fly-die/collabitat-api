import Fastify from "fastify";
import { healthRoutes } from "./routes/health.js";

export function buildApp() {
  const app = Fastify({ logger: process.env.NODE_ENV !== "test" });
  app.register(healthRoutes);
  return app;
}
