import { NextResponse } from "next/server";
import { requireOwner } from "../../../../lib/auth/guard";
import { listPendingConfirmations } from "../../../../lib/payday/confirmation";

export async function GET(request: Request) {
  const owner = await requireOwner(request);
  if (owner instanceof Response) return owner;
  try {
    return NextResponse.json({ occurrences: await listPendingConfirmations() });
  } catch {
    return NextResponse.json({ error: "Unable to load paycheck confirmations." }, { status: 503 });
  }
}
