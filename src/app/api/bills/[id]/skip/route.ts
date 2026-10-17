import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, requireOwner } from "../../../../../lib/auth/guard";
import { BillPostingError, skipBillInstance } from "../../../../../lib/bills/posting";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const originError = assertSameOrigin(req);
  if (originError) return originError;
  const owner = await requireOwner(req);
  if (owner instanceof Response) return owner;
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "Invalid bill identifier." }, { status: 400 });
  }
  try {
    return NextResponse.json({ instance: await skipBillInstance(id) });
  } catch (error) {
    if (!(error instanceof BillPostingError)) console.error("Skip bill failed:", error);
    return NextResponse.json({ error: error instanceof BillPostingError ? error.message : "Unable to skip this bill." }, {
      status: error instanceof BillPostingError ? error.status : 500,
    });
  }
}
