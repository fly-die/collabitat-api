import { randomBytes, randomUUID, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";
import { AccountError, AccountErrorCode } from "./account-errors.js";

export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 200;
export const MAX_EMAIL_LENGTH = 254;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const HASH_SCHEME = "scrypt";
const SCRYPT_COST = 16_384;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELIZATION = 1;
const KEY_LENGTH = 64;
const SALT_BYTES = 16;

export interface Credentials {
  email: string;
  password: string;
}

export interface Account {
  id: string;
  email: string;
  passwordHash: string;
}

function deriveKey(password: string, salt: Buffer, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password, salt, KEY_LENGTH, options, (error, key) => (error ? reject(error) : resolve(key))),
  );
}

export function normalizeEmail(rawEmail: string) {
  const email = rawEmail.trim().toLowerCase();
  if (email.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(email)) {
    throw new AccountError(AccountErrorCode.InvalidEmail, "Enter an email like lea@example.com.");
  }
  return email;
}

function validatePassword(password: string) {
  if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
    throw new AccountError(
      AccountErrorCode.InvalidPassword,
      `Use at least ${MIN_PASSWORD_LENGTH} characters for your password.`,
    );
  }
}

// Stored as scrypt$cost$blockSize$parallelization$salt$key, so the cost can be raised later.
export async function hashPassword(password: string) {
  const salt = randomBytes(SALT_BYTES);
  const key = await deriveKey(password, salt, {
    N: SCRYPT_COST,
    r: SCRYPT_BLOCK_SIZE,
    p: SCRYPT_PARALLELIZATION,
  });
  return [
    HASH_SCHEME,
    SCRYPT_COST,
    SCRYPT_BLOCK_SIZE,
    SCRYPT_PARALLELIZATION,
    salt.toString("base64"),
    key.toString("base64"),
  ].join("$");
}

export async function verifyPassword(password: string, passwordHash: string) {
  const [scheme, cost, blockSize, parallelization, salt, key] = passwordHash.split("$");
  if (scheme !== HASH_SCHEME || !key) {
    return false;
  }
  const expectedKey = Buffer.from(key, "base64");
  const actualKey = await deriveKey(password, Buffer.from(salt, "base64"), {
    N: Number(cost),
    r: Number(blockSize),
    p: Number(parallelization),
  });
  return actualKey.length === expectedKey.length && timingSafeEqual(actualKey, expectedKey);
}

export async function createAccount(credentials: Credentials): Promise<Account> {
  const email = normalizeEmail(credentials.email);
  validatePassword(credentials.password);
  return { id: randomUUID(), email, passwordHash: await hashPassword(credentials.password) };
}
