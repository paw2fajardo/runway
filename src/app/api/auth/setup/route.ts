import { NextResponse } from "next/server";
import { db } from "../../../../db";
import { ownerAuth } from "../../../../db/schema";
import { hashPassword } from "../../../../lib/auth/password";
import { assertSameOrigin } from "../../../../lib/auth/guard";

function credentials(value: unknown): { username: string; password: string } | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  if (typeof input.username !== "string" || typeof input.password !== "string") return null;
  const username = input.username.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{2,79}$/.test(username) || input.password.length < 12 || input.password.length > 1_024) return null;
  return { username, password: input.password };
}

export async function GET() {
  try {
    const [owner] = await db.select({ id: ownerAuth.id }).from(ownerAuth).limit(1);
    return NextResponse.json({ configured: Boolean(owner) });
  } catch {
    return NextResponse.json({ error: "Unable to check owner setup." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const originError = assertSameOrigin(request);
  if (originError) return originError;
  const input = credentials(await request.json().catch(() => undefined));
  if (!input) return NextResponse.json({ error: "Enter a valid username and password." }, { status: 400 });

  let passwordHash: string;
  try {
    passwordHash = await hashPassword(input.password);
  } catch {
    return NextResponse.json({ error: "Unable to complete owner setup." }, { status: 503 });
  }

  try {
    const [owner] = await db.insert(ownerAuth)
      .values({ id: 1, username: input.username, passwordHash })
      .onConflictDoNothing()
      .returning({ id: ownerAuth.id });
    if (!owner) return NextResponse.json({ error: "Owner setup is already complete." }, { status: 409 });
    return NextResponse.json({ configured: true }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Unable to complete owner setup." }, { status: 503 });
  }
}
