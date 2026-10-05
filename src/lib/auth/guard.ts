import { NextResponse } from "next/server";
import { getOwnerFromRequest, type Owner } from "./session";

const LOGIN_FAILURE_LIMIT = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1_000;
const MAX_LOGIN_KEYS = 5_000;
type FailureWindow = { failures: number; blockedUntil: number };
const loginFailures = new Map<string, FailureWindow>();
const ipKey = (ip: string) => `ip:${ip}`;

export async function requireOwner(request: Request): Promise<Owner | Response> {
  const owner = await getOwnerFromRequest(request);
  return owner ?? NextResponse.json({ error: "Authentication required." }, { status: 401 });
}

/** Reject a supplied Origin unless it exactly matches the request's public origin. */
export function assertSameOrigin(request: Request): Response | null {
  const origin = request.headers.get("origin");
  if (origin === null) return null; // Non-browser clients do not send Origin.

  try {
    if (new URL(origin).origin === new URL(request.url).origin) return null;
  } catch {
    // Malformed and opaque origins are never trusted.
  }
  return NextResponse.json({ error: "Request origin is not allowed." }, { status: 403 });
}

function pruneLoginFailures(now: number): void {
  for (const [key, window] of loginFailures) {
    if (now >= window.blockedUntil) loginFailures.delete(key);
  }
  while (loginFailures.size >= MAX_LOGIN_KEYS - 1) {
    const oldest = loginFailures.keys().next().value;
    if (oldest === undefined) break;
    loginFailures.delete(oldest);
  }
}

export function isLoginThrottled(ip: string, now = Date.now()): boolean {
  const entry = loginFailures.get(ipKey(ip));
  return Boolean(entry && entry.failures >= LOGIN_FAILURE_LIMIT && entry.blockedUntil > now);
}

export function recordLoginFailure(ip: string, now = Date.now()): void {
  pruneLoginFailures(now);
  const keyPart = ipKey(ip);
  const previous = loginFailures.get(keyPart);
  const withinWindow = previous && now < previous.blockedUntil;
  const failures = withinWindow ? previous.failures + 1 : 1;
  loginFailures.delete(keyPart);
  loginFailures.set(keyPart, { failures, blockedUntil: now + LOGIN_WINDOW_MS });
}

export function clearLoginFailures(ip: string): void {
  loginFailures.delete(ipKey(ip));
}

export function resetLoginThrottleForTests(): void {
  loginFailures.clear();
}
