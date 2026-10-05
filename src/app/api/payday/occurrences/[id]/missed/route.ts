import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, requireOwner } from "../../../../../../lib/auth/guard";
import { markPaycheckMissed } from "../../../../../../lib/payday/confirmation";
import { DateOnlySchema } from "../../../../../../lib/types";

const BodySchema = z.object({ retry_date: DateOnlySchema }).strict();
type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Context) {
  const originError = assertSameOrigin(request);
  if (originError) return originError;
  const owner = await requireOwner(request);
  if (owner instanceof Response) return owner;
  let body: unknown;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Provide a valid retry date." }, { status: 400 }); }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Provide a valid retry date." }, { status: 400 });
  try {
    const { id } = await params;
    const result = await markPaycheckMissed(id, parsed.data.retry_date);
    if (result === "invalid_date") return NextResponse.json({ error: "Retry date must be a valid future Manila date." }, { status: 400 });
    if (result === "not_found") return NextResponse.json({ error: "Paycheck occurrence not found." }, { status: 404 });
    if (result === "invalid_state") return NextResponse.json({ error: "Paycheck cannot be marked missed in its current state." }, { status: 409 });
    return NextResponse.json({ missed: true, retry_date: parsed.data.retry_date });
  } catch {
    return NextResponse.json({ error: "Unable to record missed paycheck." }, { status: 503 });
  }
}
