import { NextResponse } from "next/server";
import { generateRegistrationOptions } from "@simplewebauthn/server";
import { assertSameOrigin, requireOwner } from "../../../../../lib/auth/guard";
import {
  createWebAuthnChallenge,
  getExpectedRpConfig,
  getOwnerPasskeys,
} from "../../../../../lib/auth/webauthn";

export async function POST(request: Request) {
  const originError = assertSameOrigin(request);
  if (originError) return originError;

  const authResult = await requireOwner(request);
  if (authResult instanceof Response) return authResult;
  const owner = authResult;

  const { rpID } = getExpectedRpConfig(request);
  const existingPasskeys = await getOwnerPasskeys(owner.id);

  const options = await generateRegistrationOptions({
    rpName: "Runway",
    rpID,
    userID: new TextEncoder().encode(String(owner.id)),
    userName: owner.username,
    userDisplayName: owner.username,
    attestationType: "none",
    excludeCredentials: existingPasskeys.map((p) => ({
      id: p.credentialId,
      transports: p.transports ? (p.transports.split(",") as any) : undefined,
    })),
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
      authenticatorAttachment: "platform", // Preferred for biometric/fingerprint
    },
  });

  createWebAuthnChallenge(`reg:${owner.id}:${options.challenge}`);

  return NextResponse.json(options);
}
