import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, requireOwner } from "../../../../../lib/auth/guard";
import { DateOnlySchema } from "../../../../../lib/types";
import { BillPostingError } from "../../../../../lib/bills/posting";
import { rescheduleBillInstance } from "../../../../../lib/bills/reschedule";

const schema = z.object({ due_date: DateOnlySchema }).strict();

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const originError = assertSameOrigin(req);
  if (originError) return originError;
  const owner = await requireOwner(req);
  if (owner instanceof Response) return owner;
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "Invalid bill identifier." }, { status: 400 });
  }
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose a valid due date." }, { status: 400 });
  try {
    return NextResponse.json({ instance: await rescheduleBillInstance(id, parsed.data.due_date) });
  } catch (error) {
    if (!(error instanceof BillPostingError)) console.error("Reschedule bill failed:", error);
    return NextResponse.json({ error: error instanceof BillPostingError ? error.message : "Unable to move this bill." }, {
      status: error instanceof BillPostingError ? error.status : 500,
    });
  }
}
