import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { ownerAuth, ownerSessions } from "../../db/schema";

export const OWNER_SESSION_COOKIE = "runway_owner_session";
const TOKEN_BYTES = 32;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export type Owner = typeof ownerAuth.$inferSelect;

function digestToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export async function createOwnerSession(ownerId: number): Promise<string> {
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  await db.insert(ownerSessions).values({ ownerId, tokenDigest: digestToken(token) });
  return token;
}

export async function getOwnerFromRequest(request: Request): Promise<Owner | null> {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const cookie = cookieHeader.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${OWNER_SESSION_COOKIE}=`));
  const token = cookie?.slice(OWNER_SESSION_COOKIE.length + 1);
  if (!token || !TOKEN_PATTERN.test(token)) return null;

  const rows = await db
    .select({ owner: ownerAuth, revokedAt: ownerSessions.revokedAt })
    .from(ownerSessions)
    .innerJoin(ownerAuth, eq(ownerSessions.ownerId, ownerAuth.id))
    .where(eq(ownerSessions.tokenDigest, digestToken(token)))
    .limit(1);
  const row = rows[0];
  if (!row || row.revokedAt !== null) return null;
  return row.owner;
}

export async function revokeSession(token: string): Promise<void> {
  if (!TOKEN_PATTERN.test(token)) return;
  await db
    .update(ownerSessions)
    .set({ revokedAt: new Date() })
    .where(eq(ownerSessions.tokenDigest, digestToken(token)));
}

export async function revokeOwnerSessions(ownerId: number): Promise<void> {
  await db
    .update(ownerSessions)
    .set({ revokedAt: new Date() })
    .where(eq(ownerSessions.ownerId, ownerId));
}

export function serializeOwnerSessionCookie(token: string): string {
  if (!TOKEN_PATTERN.test(token)) throw new Error("Invalid owner session token");
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${OWNER_SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax${secure}`;
}

export function serializeClearedOwnerSessionCookie(): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${OWNER_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=0`;
}
