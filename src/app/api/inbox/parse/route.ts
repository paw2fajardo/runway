import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { inboxItems } from "@/db/schema";
import { parseInboxText } from "@/lib/ai-parser";
import { z } from "zod";

const ParseRequestSchema = z.object({
  raw_payload: z.string().min(1, "Payload cannot be empty"),
  source_channel: z
    .enum(["sms", "ocr_receipt", "pdf_bill", "quick_text", "manual"])
    .default("quick_text"),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsedInput = ParseRequestSchema.parse(body);

    // Call AI / heuristic parser
    const parsedData = await parseInboxText(parsedInput.raw_payload);

    // Save strictly to staging table inbox_items
    const [stagedItem] = await db
      .insert(inboxItems)
      .values({
        sourceChannel: parsedInput.source_channel,
        rawPayload: parsedInput.raw_payload,
        parsedJson: parsedData,
        status: "pending",
      })
      .returning();

    return NextResponse.json(stagedItem, { status: 201 });
  } catch (error: unknown) {
    console.error("AI Ingestion parse failed:", error);
    const message = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
