import { createHash, randomBytes } from "node:crypto";

const SESSION_TOKEN_BYTES = 32;

// Only the hash is stored, so a leaked database does not hand out working sessions.
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function createSessionToken() {
  const token = randomBytes(SESSION_TOKEN_BYTES).toString("base64url");
  return { token, tokenHash: hashSessionToken(token) };
}
