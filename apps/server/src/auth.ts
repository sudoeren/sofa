import { createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const KEY_LENGTH = 32;
const SCRYPT_COST = 16384;

function derive(password: string, salt: Buffer, cost: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize("NFKC"), salt, KEY_LENGTH, { N: cost, r: 8, p: 1 }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

/** Format: scrypt$<N>$<salt base64>$<key base64> */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, SCRYPT_COST);
  return `scrypt$${SCRYPT_COST}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "scrypt") return false;
  const cost = Number(parts[1]);
  if (!Number.isInteger(cost) || cost < 2 || cost > 1 << 20) return false;
  const salt = Buffer.from(parts[2] ?? "", "base64");
  const expected = Buffer.from(parts[3] ?? "", "base64");
  if (expected.length !== KEY_LENGTH) return false;
  try {
    const actual = await derive(password, salt, cost);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function signSpaceToken(secret: Buffer, spaceId: string): string {
  return createHmac("sha256", secret).update(`space:${spaceId}`).digest("base64url");
}

export function verifySpaceToken(secret: Buffer, spaceId: string, token: unknown): boolean {
  if (typeof token !== "string" || token.length === 0 || token.length > 200) return false;
  const expected = Buffer.from(signSpaceToken(secret, spaceId));
  const given = Buffer.from(token);
  if (given.length !== expected.length) return false;
  return timingSafeEqual(given, expected);
}

export function bearerToken(header: string | undefined | null): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header);
  return match?.[1] ?? null;
}

export type RateLimiter = {
  /** Count one attempt. Returns false when the key is over its limit. */
  hit(key: string): boolean;
  reset(key: string): void;
};

/** Fixed window counter kept in memory; enough for one process. */
export function createRateLimiter(limit: number, windowMs: number): RateLimiter {
  const windows = new Map<string, { count: number; resetAt: number }>();
  let lastSweep = Date.now();

  function sweep(now: number) {
    if (now - lastSweep < windowMs && windows.size < 10_000) return;
    lastSweep = now;
    for (const [key, entry] of windows) if (entry.resetAt <= now) windows.delete(key);
  }

  return {
    hit(key) {
      const now = Date.now();
      sweep(now);
      const entry = windows.get(key);
      if (!entry || entry.resetAt <= now) {
        windows.set(key, { count: 1, resetAt: now + windowMs });
        return limit >= 1;
      }
      entry.count += 1;
      return entry.count <= limit;
    },
    reset(key) {
      windows.delete(key);
    },
  };
}
