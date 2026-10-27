import cors from "@fastify/cors";
import Fastify from "fastify";
import { householdRoutes } from "./households/household-routes.js";
import {
  InMemoryHouseholdRepository,
  type HouseholdRepository,
} from "./households/household-repository.js";
import { healthRoutes } from "./routes/health.js";

export interface AppDependencies {
  householdRepository?: HouseholdRepository;
  webOrigins?: string[];
}

export function buildApp({
  householdRepository = new InMemoryHouseholdRepository(),
  webOrigins = [],
}: AppDependencies = {}) {
  const app = Fastify({ logger: process.env.NODE_ENV !== "test" });
  app.register(cors, { origin: webOrigins, methods: ["GET", "POST", "DELETE"] });
  app.register(healthRoutes);
  app.register(householdRoutes(householdRepository));
  return app;
}
