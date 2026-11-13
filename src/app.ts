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
import { expenseRoutes, type ExpenseAddedListener } from "./expenses/expense-routes.js";
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
import { fetchPublicPage, type FetchPage } from "./meals/page-fetcher.js";
import { InMemoryShoppingItemRepository, type ShoppingItemRepository } from "./meals/shopping-item-repository.js";
import { shoppingRoutes } from "./meals/shopping-routes.js";
import { InMemoryShoppingTripRepository, type ShoppingTripRepository } from "./meals/shopping-trip-repository.js";
import { InMemoryCalendarRepository, type CalendarRepository } from "./calendar/calendar-repository.js";
import { calendarRoutes } from "./calendar/calendar-routes.js";
import { InMemoryNoteRepository, type NoteRepository } from "./notes/note-repository.js";
import { noteRoutes } from "./notes/note-routes.js";
import { startChoreReminders } from "./notifications/chore-reminders.js";
import { expenseAddedMessages } from "./notifications/expense-notifications.js";
import { notificationRoutes } from "./notifications/notification-routes.js";
import type { Household } from "./households/household.js";
import {
  InMemoryNotificationPreferenceRepository,
  type NotificationPreferenceRepository,
} from "./notifications/notification-preferences.js";
import { createNotifier } from "./notifications/notifier.js";
import { shoppingStartedMessage } from "./notifications/shopping-notifications.js";
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
  calendarRepository?: CalendarRepository;
  noteRepository?: NoteRepository;
  pushSubscriptionRepository?: PushSubscriptionRepository;
  notificationPreferenceRepository?: NotificationPreferenceRepository;
  reminderLog?: ReminderLog;
  // Without one, notifications are off: the switch says so and nothing is sent.
  pushSender?: PushSender;
  // Only the real server sends the morning chore reminders; tests call them directly.
  sendsChoreReminders?: boolean;
  webOrigins?: string[];
  // Opens recipe pages for the import; tests pass their own pages.
  fetchPage?: FetchPage;
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
  calendarRepository = new InMemoryCalendarRepository(),
  noteRepository = new InMemoryNoteRepository(),
  pushSubscriptionRepository = new InMemoryPushSubscriptionRepository(),
  notificationPreferenceRepository = new InMemoryNotificationPreferenceRepository(),
  reminderLog = new InMemoryReminderLog(),
  pushSender,
  sendsChoreReminders = false,
  webOrigins = [],
  fetchPage = fetchPublicPage,
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
  const notify = createNotifier(pushSubscriptionRepository, notificationPreferenceRepository, pushSender, app.log);
  const onExpenseAdded: ExpenseAddedListener = (household, expense, addedByMemberId) => {
    for (const { memberId, message } of expenseAddedMessages(household, expense, addedByMemberId)) {
      void notify([memberId], message, "money");
    }
  };
  app.register(expenseRoutes({ authenticate, expenseRepository, settlementRepository, onExpenseAdded }));
  app.register(
    notificationRoutes({
      authenticate,
      subscriptions: pushSubscriptionRepository,
      preferences: notificationPreferenceRepository,
      publicKey: pushSender?.publicKey,
    }),
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
  const onTripStarted = (household: Household, shopperMemberId: string) => {
    const { memberIds, message } = shoppingStartedMessage(household, shopperMemberId);
    void notify(memberIds, message, "shopping");
  };
  app.register(taskRoutes({ authenticate, taskRepository }));
  app.register(mealRoutes({ authenticate, mealRepository, fetchPage }));
  app.register(
    shoppingRoutes({ authenticate, mealRepository, shoppingItemRepository, shoppingTripRepository, onTripStarted, expenseRepository, onExpenseAdded }),
  );
  app.register(calendarRoutes({ authenticate, calendarRepository }));
  app.register(noteRoutes({ authenticate, noteRepository }));
  app.register(liveRoutes({ authenticateToken, liveHub }));
  return app;
}
