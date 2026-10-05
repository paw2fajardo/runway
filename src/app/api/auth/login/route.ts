import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "../../../../db";
import { ownerAuth } from "../../../../db/schema";
import { verifyPassword } from "../../../../lib/auth/password";
import { createOwnerSession, serializeOwnerSessionCookie } from "../../../../lib/auth/session";
import { assertSameOrigin, clearLoginFailures, isLoginThrottled, recordLoginFailure } from "../../../../lib/auth/guard";

const DUMMY_HASH = `scrypt$16384$8$1$${"0".repeat(32)}$${"0".repeat(128)}`;

function loginInput(value: unknown): { username: string; password: string } | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  if (typeof input.username !== "string" || typeof input.password !== "string") return null;
  const username = input.username.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{2,79}$/.test(username) || input.password.length > 1_024) return null;
  return { username, password: input.password };
}

function clientAddress(request: Request): string {
  // Use a single proxy-provided address only. The app is deployed behind the owner's trusted proxy.
  const forwarded = request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim();
  return forwarded || "unknown";
}

export async function POST(request: Request) {
  const originError = assertSameOrigin(request);
  if (originError) return originError;
  const input = loginInput(await request.json().catch(() => undefined));
  if (!input) return NextResponse.json({ error: "Invalid username or password." }, { status: 401 });

  const ip = clientAddress(request);
  if (isLoginThrottled(ip)) {
    return NextResponse.json({ error: "Invalid username or password." }, { status: 401 });
  }

  try {
    const [owner] = await db.select().from(ownerAuth).where(eq(ownerAuth.username, input.username)).limit(1);
    const valid = await verifyPassword(input.password, owner?.passwordHash ?? DUMMY_HASH);
    if (!owner || !valid) {
      recordLoginFailure(ip);
      return NextResponse.json({ error: "Invalid username or password." }, { status: 401 });
    }

    clearLoginFailures(ip);
    const token = await createOwnerSession(owner.id);
    const response = NextResponse.json({ authenticated: true });
    response.headers.append("Set-Cookie", serializeOwnerSessionCookie(token));
    return response;
  } catch {
    return NextResponse.json({ error: "Unable to sign in." }, { status: 503 });
  }
}
