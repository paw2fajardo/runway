import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "../../../../db";
import { ownerAuth, ownerSessions } from "../../../../db/schema";
import { hashPassword, verifyPassword } from "../../../../lib/auth/password";
import { assertSameOrigin, requireOwner } from "../../../../lib/auth/guard";
import { serializeClearedOwnerSessionCookie } from "../../../../lib/auth/session";

export async function PATCH(request: Request) {
  const originError = assertSameOrigin(request);
  if (originError) return originError;
  const owner = await requireOwner(request);
  if (owner instanceof Response) return owner;

  const value = await request.json().catch(() => undefined);
  if (!value || typeof value !== "object") return NextResponse.json({ error: "Enter your current and new passwords." }, { status: 400 });
  const input = value as Record<string, unknown>;
  if (typeof input.currentPassword !== "string" || typeof input.newPassword !== "string") {
    return NextResponse.json({ error: "Enter your current and new passwords." }, { status: 400 });
  }
  if (!await verifyPassword(input.currentPassword, owner.passwordHash)) {
    return NextResponse.json({ error: "Current password is incorrect." }, { status: 400 });
  }
  if (input.newPassword.length < 12 || input.newPassword.length > 1_024) {
    return NextResponse.json({ error: "New password must be between 12 and 1024 characters." }, { status: 400 });
  }

  let passwordHash: string;
  try {
    passwordHash = await hashPassword(input.newPassword);
  } catch {
    return NextResponse.json({ error: "Unable to update password." }, { status: 503 });
  }

  try {
    await db.transaction(async (tx) => {
      await tx.update(ownerAuth).set({ passwordHash, updatedAt: new Date() }).where(eq(ownerAuth.id, owner.id));
      await tx.update(ownerSessions)
        .set({ revokedAt: new Date() })
        .where(eq(ownerSessions.ownerId, owner.id));
    });
    const response = NextResponse.json({ authenticated: false, reauthenticationRequired: true });
    response.headers.append("Set-Cookie", serializeClearedOwnerSessionCookie());
    return response;
  } catch {
    return NextResponse.json({ error: "Unable to update password." }, { status: 503 });
  }
}
