import { NextResponse } from "next/server";
import { assertSameOrigin } from "../../../../lib/auth/guard";
import { OWNER_SESSION_COOKIE, revokeSession, serializeClearedOwnerSessionCookie } from "../../../../lib/auth/session";

function sessionToken(request: Request): string | null {
  const cookie = (request.headers.get("cookie") ?? "").split(";").map((part) => part.trim())
    .find((part) => part.startsWith(`${OWNER_SESSION_COOKIE}=`));
  return cookie?.slice(OWNER_SESSION_COOKIE.length + 1) ?? null;
}

export async function POST(request: Request) {
  const originError = assertSameOrigin(request);
  if (originError) return originError;
  const token = sessionToken(request);
  if (token) {
    try {
      await revokeSession(token);
    } catch {
      return NextResponse.json({ error: "Unable to sign out." }, { status: 503 });
    }
  }
  const response = NextResponse.json({ authenticated: false });
  response.headers.append("Set-Cookie", serializeClearedOwnerSessionCookie());
  return response;
}
