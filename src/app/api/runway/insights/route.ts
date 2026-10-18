import { NextResponse } from "next/server";
import { requireOwner } from "../../../../lib/auth/guard";
import { loadInsights } from "../../../../lib/load-insights";

export async function GET(request: Request) {
  const owner = await requireOwner(request);
  if (owner instanceof Response) return owner;
  try { return NextResponse.json(await loadInsights()); }
  catch { return NextResponse.json({ error: "Insights unavailable. Retry to load your spending history." }, { status: 503 }); }
}
