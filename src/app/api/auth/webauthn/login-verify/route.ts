import { NextResponse } from "next/server";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { eq } from "drizzle-orm";
import {
  assertSameOrigin,
  clearLoginFailures,
  isLoginThrottled,
  recordLoginFailure,
} from "../../../../../lib/auth/guard";
import {
  consumeWebAuthnChallenge,
  getExpectedRpConfig,
  getPasskeyByCredentialId,
} from "../../../../../lib/auth/webauthn";
import {
  createOwnerSession,
  serializeOwnerSessionCookie,
} from "../../../../../lib/auth/session";
import { db } from "../../../../../db";
import { ownerPasskeys } from "../../../../../db/schema";

function clientAddress(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim();
  return forwarded || "unknown";
}

export async function POST(request: Request) {
  const originError = assertSameOrigin(request);
  if (originError) return originError;

  const ip = clientAddress(request);
  if (isLoginThrottled(ip)) {
    return NextResponse.json({ error: "Too many login attempts." }, { status: 429 });
  }

  const body = (await request.json().catch(() => null)) as {
    response?: AuthenticationResponseJSON;
  } | null;

  if (!body?.response) {
    return NextResponse.json({ error: "Invalid authentication response." }, { status: 400 });
  }

  const clientResponse = body.response;
  let challenge: string | null = null;
  try {
    if (clientResponse.response?.clientDataJSON) {
      const parsed = JSON.parse(Buffer.from(clientResponse.response.clientDataJSON, "base64url").toString("utf-8"));
      challenge = typeof parsed.challenge === "string" ? parsed.challenge : null;
    }
  } catch {
    challenge = null;
  }

  if (!challenge) {
    recordLoginFailure(ip);
    return NextResponse.json({ error: "Missing or malformed challenge." }, { status: 400 });
  }

  const expectedChallenge = await consumeWebAuthnChallenge(`auth:${challenge}`);
  if (!expectedChallenge) {
    return NextResponse.json({ error: "Authentication challenge expired or invalid." }, { status: 400 });
  }

  if (typeof clientResponse.id !== "string" || !clientResponse.id) {
    return NextResponse.json({ error: "Missing or invalid credential ID." }, { status: 400 });
  }

  let passkey: Awaited<ReturnType<typeof getPasskeyByCredentialId>>;
  try {
    passkey = await getPasskeyByCredentialId(clientResponse.id);
  } catch {
    return NextResponse.json({ error: "Unable to verify credential." }, { status: 503 });
  }

  if (!passkey) {
    recordLoginFailure(ip);
    return NextResponse.json({ error: "Unrecognized credential." }, { status: 401 });
  }

  const { rpID, origin } = getExpectedRpConfig(request);

  let verification: Awaited<ReturnType<typeof verifyAuthenticationResponse>>;
  try {
    verification = await verifyAuthenticationResponse({
      response: clientResponse,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: {
        id: passkey.credentialId,
        publicKey: Buffer.from(passkey.publicKey, "base64url"),
        counter: passkey.counter,
        transports: passkey.transports ? (passkey.transports.split(",") as any) : undefined,
      },
      requireUserVerification: false,
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : "Verification failed";
    console.error("WebAuthn login error:", reason, { origin, rpID, expectedChallenge });
    recordLoginFailure(ip);
    return NextResponse.json({ error: `Authentication failed: ${reason}` }, { status: 401 });
  }

  if (!verification.verified) {
    recordLoginFailure(ip);
    return NextResponse.json({ error: "Authentication failed." }, { status: 401 });
  }

  try {
    // Update counter and lastUsedAt
    await db
      .update(ownerPasskeys)
      .set({
        counter: verification.authenticationInfo.newCounter,
        lastUsedAt: new Date(),
      })
      .where(eq(ownerPasskeys.id, passkey.id));

    clearLoginFailures(ip);
    const token = await createOwnerSession(passkey.ownerId);
    const response = NextResponse.json({ authenticated: true });
    response.headers.append("Set-Cookie", serializeOwnerSessionCookie(token));
    return response;
  } catch {
    return NextResponse.json({ error: "Unable to complete sign-in." }, { status: 503 });
  }
}
