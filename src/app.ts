import Fastify from "fastify";
import { householdRoutes } from "./households/household-routes.js";
import {
  InMemoryHouseholdRepository,
  type HouseholdRepository,
} from "./households/household-repository.js";
import { healthRoutes } from "./routes/health.js";

export interface AppDependencies {
  householdRepository?: HouseholdRepository;
}

export function buildApp({
  householdRepository = new InMemoryHouseholdRepository(),
}: AppDependencies = {}) {
  const app = Fastify({ logger: process.env.NODE_ENV !== "test" });
  app.register(healthRoutes);
  app.register(householdRoutes(householdRepository));
  return app;
}
