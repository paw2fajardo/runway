import { randomBytes } from "node:crypto";
import { and, eq, lte } from "drizzle-orm";
import { db } from "../../db";
import { ownerAuth, ownerPasskeys, ownerChallenges, type ownerPasskeys as ownerPasskeysType } from "../../db/schema";

export type Passkey = typeof ownerPasskeys.$inferSelect;

const CHALLENGE_EXPIRY_MS = 10 * 60 * 1000;

export async function saveWebAuthnChallenge(key: string, challenge: string): Promise<void> {
  // Prune expired challenges opportunistically
  const now = new Date();
  await db.delete(ownerChallenges).where(lte(ownerChallenges.expiresAt, now)).catch(() => undefined);

  const expiresAt = new Date(Date.now() + CHALLENGE_EXPIRY_MS);
  // Delete existing key if any, then insert new
  await db.delete(ownerChallenges).where(eq(ownerChallenges.key, key)).catch(() => undefined);
  await db.insert(ownerChallenges).values({ key, challenge, expiresAt });
}

export async function createWebAuthnChallenge(key: string): Promise<string> {
  const challenge = randomBytes(32).toString("base64url");
  await saveWebAuthnChallenge(key, challenge);
  return challenge;
}

export async function consumeWebAuthnChallenge(key: string): Promise<string | null> {
  const [row] = await db
    .select()
    .from(ownerChallenges)
    .where(eq(ownerChallenges.key, key))
    .limit(1);

  if (!row) return null;

  // Single-use: delete immediately
  await db.delete(ownerChallenges).where(eq(ownerChallenges.key, key)).catch(() => undefined);

  if (new Date(row.expiresAt).getTime() <= Date.now()) return null;
  return row.challenge;
}

export async function resetChallengesForTests(): Promise<void> {
  await db.delete(ownerChallenges).catch(() => undefined);
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
