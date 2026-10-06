import { NextRequest, NextResponse } from "next/server";
import { assertSameOrigin, requireOwner } from "../../../../lib/auth/guard";
import { processDueAutoPayBills } from "../../../../lib/bills/posting";

/** Catch up due auto-pay bills when the owner opens the app without a worker. */
export async function POST(req: NextRequest) {
  const originError = assertSameOrigin(req);
  if (originError) return originError;
  const owner = await requireOwner(req);
  if (owner instanceof Response) return owner;
  try {
    const posted = await processDueAutoPayBills();
    return NextResponse.json({ posted });
  } catch (error) {
    console.error("Auto-pay catch-up failed:", error);
    return NextResponse.json({ error: "Unable to check scheduled auto-pay bills." }, { status: 500 });
  }
}
