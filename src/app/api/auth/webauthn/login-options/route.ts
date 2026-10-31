import { NextResponse } from "next/server";
import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { assertSameOrigin, isLoginThrottled } from "../../../../../lib/auth/guard";
import {
  createWebAuthnChallenge,
  getExpectedRpConfig,
  getOwnerPasskeys,
} from "../../../../../lib/auth/webauthn";
import { db } from "../../../../../db";
import { ownerAuth } from "../../../../../db/schema";

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

  const [owner] = await db.select().from(ownerAuth).limit(1);
  if (!owner) {
    return NextResponse.json({ error: "Owner not configured." }, { status: 400 });
  }

  const passkeys = await getOwnerPasskeys(owner.id);
  if (passkeys.length === 0) {
    return NextResponse.json({ error: "No biometric credentials registered." }, { status: 404 });
  }

  const { rpID } = getExpectedRpConfig(request);

  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: "preferred",
    allowCredentials: passkeys.map((p) => ({
      id: p.credentialId,
      transports: p.transports ? (p.transports.split(",") as any) : undefined,
    })),
  });

  createWebAuthnChallenge(`auth:${options.challenge}`);

  return NextResponse.json(options);
}
