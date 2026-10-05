import { NextRequest, NextResponse } from "next/server";
import { asc } from "drizzle-orm";
import { db } from "../../../db";
import { categories } from "../../../db/schema";
import { CategoryCreateSchema } from "../../../lib/types";
import { assertSameOrigin, requireOwner } from "../../../lib/auth/guard";

function uniqueConflict(error: unknown) {
  const cause = error && typeof error === "object" && "cause" in error ? error.cause : error;
  return !!cause && typeof cause === "object" && "code" in cause && cause.code === "23505";
}

export async function GET(req: NextRequest) {
  const owner = await requireOwner(req);
  if (owner instanceof Response) return owner;
  try {
    const includeArchived = req.nextUrl.searchParams.get("include_archived") === "true";
    const result = await db.select().from(categories).orderBy(asc(categories.name));
    return NextResponse.json((includeArchived ? result : result.filter(category => !category.isArchived && !category.isSystemFee)));
  } catch {
    return NextResponse.json({ error: "Unable to access categories." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const originError = assertSameOrigin(req);
  if (originError) return originError;
  const owner = await requireOwner(req);
  if (owner instanceof Response) return owner;
  const parsed = CategoryCreateSchema.safeParse(await req.json().catch(() => undefined));
  if (!parsed.success) return NextResponse.json({ error: "Enter a category name up to 100 characters." }, { status: 400 });
  try {
    const [category] = await db.insert(categories).values({ name: parsed.data.name, isIncome: parsed.data.is_income }).returning();
    return NextResponse.json(category, { status: 201 });
  } catch (error) {
    if (uniqueConflict(error)) return NextResponse.json({ error: "A category with that name already exists." }, { status: 409 });
    return NextResponse.json({ error: "Unable to create category." }, { status: 500 });
  }
}
