import { randomUUID } from "node:crypto";

export const TEST_PASSWORD = "correct horse battery";

// A fresh email per call, so tests never collide on the one-account-per-email rule.
export function newCredentials(name = "someone") {
  return { email: `${name}-${randomUUID()}@example.com`, password: TEST_PASSWORD };
}
