import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, requireOwner } from "../../../../../lib/auth/guard";
import { BillPostingError, postBillInstance } from "../../../../../lib/bills/posting";

const settlementSchema = z.object({
  amount: z.number().int().positive().optional(),
  source_account_id: z.string().uuid().optional(),
}).strict();

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const originError = assertSameOrigin(req);
  if (originError) return originError;
  const owner = await requireOwner(req);
  if (owner instanceof Response) return owner;

  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "Invalid bill identifier." }, { status: 400 });
  }
  const parsed = settlementSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter a valid payment amount and account." }, { status: 400 });
  }
  try {
    const result = await postBillInstance(id, {
      amount: parsed.data.amount,
      sourceAccountId: parsed.data.source_account_id,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (!(error instanceof BillPostingError)) console.error("Settle bill failed:", error);
    return NextResponse.json({ error: error instanceof BillPostingError ? error.message : "Unable to record this payment." }, {
      status: error instanceof BillPostingError ? error.status : 500,
    });
  }
}
