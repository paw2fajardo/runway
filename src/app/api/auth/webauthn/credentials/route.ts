import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { assertSameOrigin, requireOwner } from "../../../../../lib/auth/guard";
import { getOwnerPasskeys } from "../../../../../lib/auth/webauthn";
import { db } from "../../../../../db";
import { ownerPasskeys } from "../../../../../db/schema";

export async function GET(request: Request) {
  const authResult = await requireOwner(request);
  if (authResult instanceof Response) return authResult;
  const owner = authResult;

  const passkeys = await getOwnerPasskeys(owner.id);
  return NextResponse.json({
    passkeys: passkeys.map((p) => ({
      id: p.id,
      deviceName: p.deviceName,
      createdAt: p.createdAt,
      lastUsedAt: p.lastUsedAt,
    })),
  });
}

export async function DELETE(request: Request) {
  const originError = assertSameOrigin(request);
  if (originError) return originError;

  const authResult = await requireOwner(request);
  if (authResult instanceof Response) return authResult;
  const owner = authResult;

  const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const body = (await request.json().catch(() => null)) as { id?: string } | null;
  if (!body?.id || typeof body.id !== "string" || !UUID_PATTERN.test(body.id)) {
    return NextResponse.json({ error: "Invalid credential ID." }, { status: 400 });
  }

  await db
    .delete(ownerPasskeys)
    .where(and(eq(ownerPasskeys.id, body.id), eq(ownerPasskeys.ownerId, owner.id)));

  return NextResponse.json({ deleted: true });
}
