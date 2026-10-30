import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import {
  InMemoryAccountRepository,
  type AccountRepository,
} from "./accounts/account-repository.js";
import { accountRoutes } from "./accounts/account-routes.js";
import { accountService } from "./accounts/account-service.js";
import { TooManyAttemptsError, registerErrorHandler } from "./error-handler.js";
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
import { householdViews } from "./households/household-view.js";
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
  accountRepository?: AccountRepository;
  webOrigins?: string[];
}

export function buildApp({
  householdRepository = new InMemoryHouseholdRepository(),
  sessionRepository = new InMemorySessionRepository(),
  expenseRepository = new InMemoryExpenseRepository(),
  accountRepository = new InMemoryAccountRepository(),
  webOrigins = [],
}: AppDependencies = {}) {
  const app = Fastify({ logger: process.env.NODE_ENV !== "test" });
  const authenticate = createAuthenticator(householdRepository, sessionRepository);
  const accounts = accountService(accountRepository);
  const views = householdViews(accountRepository, sessionRepository);

  registerErrorHandler(app);
  app.register(cors, {
    origin: webOrigins,
    methods: ["GET", "POST", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
  });
  app.register(rateLimit, {
    global: false,
    errorResponseBuilder: () => new TooManyAttemptsError(),
  });
  app.register(healthRoutes);
  app.register(
    householdRoutes({ authenticate, accounts, accountRepository, householdRepository, expenseRepository, views }),
  );
  app.register(
    accountRoutes({ authenticate, accounts, accountRepository, householdRepository, sessionRepository, views }),
  );
  app.register(expenseRoutes({ authenticate, expenseRepository }));
  return app;
}
