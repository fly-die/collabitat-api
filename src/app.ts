import cors from "@fastify/cors";
import Fastify from "fastify";
import { registerErrorHandler } from "./error-handler.js";
import {
  InMemoryExpenseRepository,
  type ExpenseRepository,
} from "./expenses/expense-repository.js";
import { expenseRoutes } from "./expenses/expense-routes.js";
import { householdRoutes } from "./households/household-routes.js";
import {
  InMemoryHouseholdRepository,
  type HouseholdRepository,
} from "./households/household-repository.js";
import { healthRoutes } from "./routes/health.js";
import { createAuthenticator } from "./sessions/authenticate.js";
import {
  InMemorySessionRepository,
  type SessionRepository,
} from "./sessions/session-repository.js";

export interface AppDependencies {
  householdRepository?: HouseholdRepository;
  sessionRepository?: SessionRepository;
  expenseRepository?: ExpenseRepository;
  webOrigins?: string[];
}

export function buildApp({
  householdRepository = new InMemoryHouseholdRepository(),
  sessionRepository = new InMemorySessionRepository(),
  expenseRepository = new InMemoryExpenseRepository(),
  webOrigins = [],
}: AppDependencies = {}) {
  const app = Fastify({ logger: process.env.NODE_ENV !== "test" });
  const authenticate = createAuthenticator(householdRepository, sessionRepository);
  registerErrorHandler(app);
  app.register(cors, {
    origin: webOrigins,
    methods: ["GET", "POST", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
  });
  app.register(healthRoutes);
  app.register(householdRoutes({ authenticate, householdRepository, sessionRepository, expenseRepository }));
  app.register(expenseRoutes({ authenticate, expenseRepository }));
  return app;
}
