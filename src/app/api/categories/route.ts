import { NextResponse } from "next/server";
import { db } from "@/db";
import { categories } from "@/db/schema";
import { and, asc, eq } from "drizzle-orm";

export async function GET() {
  try {
    const savedCategories = await db
      .select({ name: categories.name })
      .from(categories)
      .where(and(eq(categories.isIncome, false), eq(categories.isSystemFee, false)))
      .orderBy(asc(categories.name));

    return NextResponse.json(savedCategories, { status: 200 });
  } catch (error: unknown) {
    console.error("Fetch categories failed:", error);
    const message = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
