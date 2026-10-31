import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { ownerAuth, ownerPasskeys, type ownerPasskeys as ownerPasskeysType } from "../../db/schema";

export type Passkey = typeof ownerPasskeys.$inferSelect;

interface ChallengeEntry {
  challenge: string;
  expiresAt: number;
}

// In-memory challenge store keyed by session/identifier (10-minute validity)
const CHALLENGE_EXPIRY_MS = 10 * 60 * 1000;
const MAX_CHALLENGES = 5000;
const challenges = new Map<string, ChallengeEntry>();

function pruneChallenges(): void {
  const now = Date.now();
  for (const [key, val] of challenges.entries()) {
    if (val.expiresAt <= now) challenges.delete(key);
  }
  while (challenges.size >= MAX_CHALLENGES) {
    const oldest = challenges.keys().next().value;
    if (oldest === undefined) break;
    challenges.delete(oldest);
  }
}

export function createWebAuthnChallenge(key: string): string {
  pruneChallenges();
  const challenge = randomBytes(32).toString("base64url");
  challenges.set(key, { challenge, expiresAt: Date.now() + CHALLENGE_EXPIRY_MS });
  return challenge;
}

export function consumeWebAuthnChallenge(key: string): string | null {
  pruneChallenges();
  const entry = challenges.get(key);
  if (!entry) return null;
  challenges.delete(key);
  if (entry.expiresAt <= Date.now()) return null;
  return entry.challenge;
}

export function resetChallengesForTests(): void {
  challenges.clear();
}

export function getExpectedRpConfig(request: Request): { rpID: string; origin: string } {
  const configuredOrigin = process.env.APP_ORIGIN;
  if (configuredOrigin) {
    const url = new URL(configuredOrigin);
    return { rpID: url.hostname, origin: url.origin };
  }

  // Support reverse proxies (e.g., Caddy, Traefik, Nginx, Cloudflare)
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",", 1)[0]?.trim();
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",", 1)[0]?.trim();
  const host = forwardedHost || request.headers.get("host")?.split(",", 1)[0]?.trim();

  if (host) {
    const proto = forwardedProto && (forwardedProto === "https" || forwardedProto === "http")
      ? forwardedProto
      : "https";
    try {
      const url = new URL(`${proto}://${host}`);
      return {
        rpID: url.hostname,
        origin: url.origin, // Automatically normalizes default ports (:80, :443)
      };
    } catch {
      // Fallback on error
    }
  }

  const url = new URL(request.url);
  return {
    rpID: url.hostname,
    origin: url.origin,
  };
}

export async function getOwnerPasskeys(ownerId: number): Promise<Passkey[]> {
  return db.select().from(ownerPasskeys).where(eq(ownerPasskeys.ownerId, ownerId));
}

export async function getPasskeyByCredentialId(credentialId: string): Promise<Passkey | null> {
  const [passkey] = await db
    .select()
    .from(ownerPasskeys)
    .where(eq(ownerPasskeys.credentialId, credentialId))
    .limit(1);
  return passkey ?? null;
}
