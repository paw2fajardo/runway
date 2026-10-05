import { NextRequest, NextResponse } from "next/server";
import { db } from "../../../db";
import { inboxItems } from "../../../db/schema";
import { desc, eq } from "drizzle-orm";
import { requireOwner } from "../../../lib/auth/guard";

export async function GET(req: NextRequest) {
  const owner = await requireOwner(req);
  if (owner instanceof Response) return owner;
  try {
    const { searchParams } = new URL(req.url);
    const statusParam = searchParams.get("status") as "pending" | "approved" | "discarded" | null;

    let query = db.select().from(inboxItems);
    if (statusParam) {
      const items = await query
        .where(eq(inboxItems.status, statusParam))
        .orderBy(desc(inboxItems.createdAt));
      return NextResponse.json(items, { status: 200 });
    }

    const items = await query.orderBy(desc(inboxItems.createdAt));
    return NextResponse.json(items, { status: 200 });
  } catch (error: unknown) {
    console.error("Fetch inbox items failed:", error);
    const message = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
