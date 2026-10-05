import { NextResponse } from "next/server";
import { assertSameOrigin, requireOwner } from "../../../../../../lib/auth/guard";
import { confirmPaycheck } from "../../../../../../lib/payday/confirmation";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Context) {
  const originError = assertSameOrigin(request);
  if (originError) return originError;
  const owner = await requireOwner(request);
  if (owner instanceof Response) return owner;
  try {
    const { id } = await params;
    const result = await confirmPaycheck(id);
    if (result === "not_found") return NextResponse.json({ error: "Paycheck occurrence not found." }, { status: 404 });
    if (result === "invalid_state") return NextResponse.json({ error: "Paycheck cannot be confirmed in its current state." }, { status: 409 });
    return NextResponse.json({ received: true, already_confirmed: result === "already_confirmed" });
  } catch {
    return NextResponse.json({ error: "Unable to confirm paycheck." }, { status: 503 });
  }
}
