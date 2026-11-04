import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyRequest } from "fastify";
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
import {
  InMemorySettlementRepository,
  type SettlementRepository,
} from "./expenses/settlement-repository.js";
import { householdRoutes } from "./households/household-routes.js";
import {
  InMemoryHouseholdRepository,
  type HouseholdRepository,
} from "./households/household-repository.js";
import { householdViews } from "./households/household-view.js";
import { healthRoutes } from "./routes/health.js";
import { LiveHub, topicsOfPath } from "./live/live-hub.js";
import { liveRoutes } from "./live/live-routes.js";
import { InMemoryMealRepository, type MealRepository } from "./meals/meal-repository.js";
import { mealRoutes } from "./meals/meal-routes.js";
import { InMemoryShoppingItemRepository, type ShoppingItemRepository } from "./meals/shopping-item-repository.js";
import { shoppingRoutes } from "./meals/shopping-routes.js";
import { InMemoryShoppingTripRepository, type ShoppingTripRepository } from "./meals/shopping-trip-repository.js";
import { startChoreReminders } from "./notifications/chore-reminders.js";
import { expenseAddedMessages } from "./notifications/expense-notifications.js";
import { notificationRoutes } from "./notifications/notification-routes.js";
import { createNotifier } from "./notifications/notifier.js";
import type { PushSender } from "./notifications/push-sender.js";
import {
  InMemoryPushSubscriptionRepository,
  InMemoryReminderLog,
  type PushSubscriptionRepository,
  type ReminderLog,
} from "./notifications/push-subscription-repository.js";
import { createAuthenticator, createTokenAuthenticator, type Authenticate } from "./sessions/authenticate.js";
import { InMemoryTaskRepository, type TaskRepository } from "./tasks/task-repository.js";
import { taskRoutes } from "./tasks/task-routes.js";
import {
  InMemorySessionRepository,
  type SessionRepository,
} from "./sessions/session-repository.js";

export interface AppDependencies {
  householdRepository?: HouseholdRepository;
  sessionRepository?: SessionRepository;
  expenseRepository?: ExpenseRepository;
  accountRepository?: AccountRepository;
  settlementRepository?: SettlementRepository;
  taskRepository?: TaskRepository;
  mealRepository?: MealRepository;
  shoppingItemRepository?: ShoppingItemRepository;
  shoppingTripRepository?: ShoppingTripRepository;
  pushSubscriptionRepository?: PushSubscriptionRepository;
  reminderLog?: ReminderLog;
  // Without one, notifications are off: the switch says so and nothing is sent.
  pushSender?: PushSender;
  // Only the real server sends the morning chore reminders; tests call them directly.
  sendsChoreReminders?: boolean;
  webOrigins?: string[];
}

const HTTP_ERROR_STATUS = 400;
// The only message a client sends is its session token.
const LIVE_MAX_MESSAGE_BYTES = 4096;

export function buildApp({
  householdRepository = new InMemoryHouseholdRepository(),
  sessionRepository = new InMemorySessionRepository(),
  expenseRepository = new InMemoryExpenseRepository(),
  accountRepository = new InMemoryAccountRepository(),
  settlementRepository = new InMemorySettlementRepository(),
  taskRepository = new InMemoryTaskRepository(),
  mealRepository = new InMemoryMealRepository(),
  shoppingItemRepository = new InMemoryShoppingItemRepository(),
  shoppingTripRepository = new InMemoryShoppingTripRepository(),
  pushSubscriptionRepository = new InMemoryPushSubscriptionRepository(),
  reminderLog = new InMemoryReminderLog(),
  pushSender,
  sendsChoreReminders = false,
  webOrigins = [],
}: AppDependencies = {}) {
  const app = Fastify({ logger: process.env.NODE_ENV !== "test" });
  const liveHub = new LiveHub();
  const authenticateToken = createTokenAuthenticator(householdRepository, sessionRepository);
  // Remembers whose request it was, so a successful change can be announced to that household.
  const householdOfRequest = new WeakMap<FastifyRequest, string>();
  const checkSession = createAuthenticator(householdRepository, sessionRepository);
  const authenticate: Authenticate = async (request) => {
    const session = await checkSession(request);
    householdOfRequest.set(request, session.household.id);
    return session;
  };
  const accounts = accountService(accountRepository);
  const views = householdViews(accountRepository, sessionRepository);

  registerErrorHandler(app);
  app.addHook("onResponse", async (request, reply) => {
    const householdId = householdOfRequest.get(request);
    if (request.method !== "GET" && reply.statusCode < HTTP_ERROR_STATUS && householdId) {
      for (const topic of topicsOfPath(request.url)) {
        liveHub.publish(householdId, topic);
      }
    }
  });
  app.register(websocket, { options: { maxPayload: LIVE_MAX_MESSAGE_BYTES } });
  app.register(cors, {
    origin: webOrigins,
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
  });
  app.register(rateLimit, {
    global: false,
    errorResponseBuilder: () => new TooManyAttemptsError(),
  });
  app.register(healthRoutes);
  app.register(
    householdRoutes({
      authenticate,
      accounts,
      accountRepository,
      householdRepository,
      expenseRepository,
      settlementRepository,
      views,
    }),
  );
  app.register(
    accountRoutes({ authenticate, accounts, accountRepository, householdRepository, sessionRepository, views }),
  );
  const notify = createNotifier(pushSubscriptionRepository, pushSender, app.log);
  app.register(
    expenseRoutes({
      authenticate,
      expenseRepository,
      settlementRepository,
      onExpenseAdded: (household, expense, addedByMemberId) => {
        for (const { memberId, message } of expenseAddedMessages(household, expense, addedByMemberId)) {
          void notify([memberId], message);
        }
      },
    }),
  );
  app.register(
    notificationRoutes({ authenticate, subscriptions: pushSubscriptionRepository, publicKey: pushSender?.publicKey }),
  );
  if (sendsChoreReminders && pushSender) {
    let stopReminders: (() => void) | undefined;
    app.addHook("onReady", async () => {
      stopReminders = startChoreReminders(
        { householdRepository, taskRepository, subscriptions: pushSubscriptionRepository, reminderLog, notify },
        app.log,
      );
    });
    app.addHook("onClose", async () => stopReminders?.());
  }
  app.register(taskRoutes({ authenticate, taskRepository }));
  app.register(mealRoutes({ authenticate, mealRepository }));
  app.register(shoppingRoutes({ authenticate, mealRepository, shoppingItemRepository, shoppingTripRepository }));
  app.register(liveRoutes({ authenticateToken, liveHub }));
  return app;
}
