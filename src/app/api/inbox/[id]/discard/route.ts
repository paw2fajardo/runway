import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { inboxItems } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const [discarded] = await db
      .update(inboxItems)
      .set({ status: "discarded" })
      .where(eq(inboxItems.id, id))
      .returning();

    if (!discarded) {
      return NextResponse.json({ error: "Inbox item not found" }, { status: 404 });
    }

    return NextResponse.json(discarded, { status: 200 });
  } catch (error: unknown) {
    console.error("Discard inbox item failed:", error);
    const message = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
