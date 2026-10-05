import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "../../../../db";
import { categories } from "../../../../db/schema";
import { CategoryPatchSchema } from "../../../../lib/types";
import { assertSameOrigin, requireOwner } from "../../../../lib/auth/guard";

function uniqueConflict(error: unknown) {
  const cause = error && typeof error === "object" && "cause" in error ? error.cause : error;
  return !!cause && typeof cause === "object" && "code" in cause && cause.code === "23505";
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const originError = assertSameOrigin(req);
  if (originError) return originError;
  const owner = await requireOwner(req);
  if (owner instanceof Response) return owner;
  const { id } = await params;
  const parsed = CategoryPatchSchema.safeParse(await req.json().catch(() => undefined));
  if (!parsed.success) return NextResponse.json({ error: "Provide a valid category change." }, { status: 400 });
  try {
    const [current] = await db.select().from(categories).where(eq(categories.id, id)).limit(1);
    if (!current) return NextResponse.json({ error: "Category not found." }, { status: 404 });
    if (current.isSystemFee && (parsed.data.is_income !== undefined || parsed.data.is_archived === true)) {
      return NextResponse.json({ error: "The system fee category cannot be retyped or archived." }, { status: 409 });
    }
    const values: Partial<typeof categories.$inferInsert> = {};
    if (parsed.data.name !== undefined) values.name = parsed.data.name;
    if (parsed.data.is_income !== undefined) values.isIncome = parsed.data.is_income;
    if (parsed.data.is_archived !== undefined) values.isArchived = parsed.data.is_archived;
    const [category] = await db.update(categories).set(values).where(eq(categories.id, id)).returning();
    return NextResponse.json(category);
  } catch (error) {
    if (uniqueConflict(error)) return NextResponse.json({ error: "A category with that name already exists." }, { status: 409 });
    return NextResponse.json({ error: "Unable to update category." }, { status: 500 });
  }
}
