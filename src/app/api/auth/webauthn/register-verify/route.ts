import { NextResponse } from "next/server";
import { verifyRegistrationResponse } from "@simplewebauthn/server";
import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { assertSameOrigin, requireOwner } from "../../../../../lib/auth/guard";
import {
  consumeWebAuthnChallenge,
  getExpectedRpConfig,
} from "../../../../../lib/auth/webauthn";
import { db } from "../../../../../db";
import { ownerPasskeys } from "../../../../../db/schema";

export async function POST(request: Request) {
  const originError = assertSameOrigin(request);
  if (originError) return originError;

  const authResult = await requireOwner(request);
  if (authResult instanceof Response) return authResult;
  const owner = authResult;

  const body = (await request.json().catch(() => null)) as {
    response?: RegistrationResponseJSON;
    deviceName?: string;
  } | null;

  if (!body?.response) {
    return NextResponse.json({ error: "Invalid registration response." }, { status: 400 });
  }

  const { rpID, origin } = getExpectedRpConfig(request);
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
    return NextResponse.json({ error: "Missing or malformed challenge in registration." }, { status: 400 });
  }

  const expectedChallenge = consumeWebAuthnChallenge(`reg:${owner.id}:${challenge}`);
  if (!expectedChallenge) {
    return NextResponse.json({ error: "Registration session expired or invalid." }, { status: 400 });
  }

  try {
    const verification = await verifyRegistrationResponse({
      response: clientResponse,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: false,
    });

    if (!verification.verified || !verification.registrationInfo) {
      return NextResponse.json({ error: "Registration verification failed." }, { status: 400 });
    }

    const { credential, credentialDeviceType } = verification.registrationInfo;

    const deviceName = typeof body.deviceName === "string" && body.deviceName.trim()
      ? body.deviceName.trim().slice(0, 100)
      : (credentialDeviceType === "singleDevice" ? "This Device" : "Passkey");

    await db.insert(ownerPasskeys).values({
      ownerId: owner.id,
      credentialId: credential.id,
      publicKey: Buffer.from(credential.publicKey).toString("base64url"),
      counter: credential.counter,
      transports: credential.transports ? credential.transports.join(",") : null,
      deviceName,
    });

    return NextResponse.json({ verified: true });
  } catch {
    return NextResponse.json({ error: "Could not verify biometric registration." }, { status: 400 });
  }
}
