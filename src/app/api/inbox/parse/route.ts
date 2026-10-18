import { NextRequest, NextResponse } from "next/server";
import { db } from "../../../../db";
import { accounts, categories, inboxItems, transactionLegs, transactions } from "../../../../db/schema";
import { parseInboxText } from "../../../../lib/ai-parser";
import { z } from "zod";
import { assertSameOrigin, requireOwner } from "../../../../lib/auth/guard";
import { ParsedInboxItemSchema } from "../../../../lib/types";
import { and, desc, eq, gte } from "drizzle-orm";
import { merchantKey } from "../../../../lib/insights";
import { RunwayAssistantRateLimiter } from "../../../../lib/runway-assistant";

const limiter = new RunwayAssistantRateLimiter(10, 60000);

const ParseRequestSchema = z.object({
  raw_payload: z.string().trim().min(1, "Payload cannot be empty").max(4000),
  source_channel: z
    .enum(["sms", "ocr_receipt", "pdf_bill", "quick_text", "manual"])
    .default("quick_text"),
}).strict();

export async function POST(req: NextRequest) {
  const originError = assertSameOrigin(req);
  if (originError) return originError;
  const owner = await requireOwner(req);
  if (owner instanceof Response) return owner;
  if (!limiter.consume(String(owner.id)).allowed) return NextResponse.json({ error: "Too many entries. Retry in a minute." }, { status: 429 });
  try {
    const body: unknown = await req.json().catch(() => undefined);
    const parsedInput = ParseRequestSchema.parse(body);

    // Call AI / heuristic parser
    const parsedData = ParsedInboxItemSchema.parse(await parseInboxText(parsedInput.raw_payload));
    const [activeAccounts, activeCategories] = await Promise.all([
      db.select().from(accounts).where(eq(accounts.isActive, true)),
      db.select().from(categories).where(and(eq(categories.isArchived, false), eq(categories.isIncome, parsedData.type === "income"), eq(categories.isSystemFee, false))),
    ]);
    // Hints only survive when uniquely matched to an existing account named in the input.
    const accountMatches = activeAccounts.filter(account => merchantKey(account.name) === merchantKey(parsedData.source_account_hint ?? "") &&
      merchantKey(parsedInput.raw_payload).includes(merchantKey(account.name)));
    parsedData.source_account_hint = accountMatches.length === 1 ? accountMatches[0].name : undefined;
    const categoryMatch = activeCategories.find(category => merchantKey(category.name) === merchantKey(parsedData.category_hint ?? ""));
    parsedData.category_hint = categoryMatch?.name;
    if (!categoryMatch && parsedData.type === "expense" && !/^Unclassified/i.test(parsedData.merchant)) {
      const history = await db.select({ description: transactions.description, categoryId: transactionLegs.categoryId })
        .from(transactions).innerJoin(transactionLegs, eq(transactionLegs.transactionId, transactions.id))
        .where(and(eq(transactions.type, "expense"), gte(transactions.transactedAt, new Date(Date.now() - 180 * 86400000))))
        .orderBy(desc(transactions.transactedAt)).limit(1000);
      const matches = history.filter(item => item.categoryId && merchantKey(item.description) === merchantKey(parsedData.merchant));
      const ids = new Set(matches.map(item => item.categoryId));
      if (matches.length >= 2 && ids.size === 1) parsedData.category_hint = activeCategories.find(category => category.id === matches[0].categoryId)?.name;
    }

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
    return NextResponse.json({ error: error instanceof z.ZodError ? "Enter up to 4,000 characters of payment details." : "Entry could not be staged. Retry." }, { status: error instanceof z.ZodError ? 400 : 503 });
  }
}
