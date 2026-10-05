import { NextResponse } from "next/server";
import { assertSameOrigin, requireOwner } from "../../../../lib/auth/guard";
import { revokeOwnerSessions, serializeClearedOwnerSessionCookie } from "../../../../lib/auth/session";

export async function DELETE(request: Request) {
  const originError = assertSameOrigin(request);
  if (originError) return originError;
  const owner = await requireOwner(request);
  if (owner instanceof Response) return owner;

  try {
    await revokeOwnerSessions(owner.id);
    const response = NextResponse.json({ revoked: true, reauthenticationRequired: true });
    response.headers.append("Set-Cookie", serializeClearedOwnerSessionCookie());
    return response;
  } catch {
    return NextResponse.json({ error: "Unable to revoke sessions." }, { status: 503 });
  }
}
