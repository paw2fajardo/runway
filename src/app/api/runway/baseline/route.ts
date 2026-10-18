import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "../../../../db";
import { forecastBaselines } from "../../../../db/schema";
import { assertSameOrigin, requireOwner } from "../../../../lib/auth/guard";
import { compareForecasts } from "../../../../lib/insights";
import { todayInManila } from "../../../../lib/bills/due-date";
import type { RunwayForecastResponse } from "../../../../lib/types";
import { GET as getForecast } from "../forecast/route";

async function currentForecast(request: Request) {
  return getForecast(new NextRequest(new URL(`/api/runway/forecast?horizon_days=45&reference_date=${todayInManila()}&comparison_inputs=true`, request.url), { headers: request.headers }));
}

export async function GET(request: Request) {
  const owner = await requireOwner(request);
  if (owner instanceof Response) return owner;
  try {
    const [baseline] = await db.select().from(forecastBaselines).where(eq(forecastBaselines.id, 1)).limit(1);
    if (!baseline) return NextResponse.json({ saved_at: null, comparison: null });
    const response = await currentForecast(request);
    if (!response.ok) return response;
    const forecast = await response.json() as RunwayForecastResponse;
    return NextResponse.json({ saved_at: baseline.savedAt, comparison: compareForecasts(baseline.forecast, forecast) });
  } catch { return NextResponse.json({ error: "Forecast comparison unavailable. Apply migration 0021 if the baseline table is missing." }, { status: 503 }); }
}

export async function POST(request: Request) {
  const origin = assertSameOrigin(request);
  if (origin) return origin;
  const owner = await requireOwner(request);
  if (owner instanceof Response) return owner;
  try {
    const response = await currentForecast(request);
    if (!response.ok) return response;
    const forecast = await response.json() as RunwayForecastResponse;
    const savedAt = new Date();
    await db.insert(forecastBaselines).values({ id: 1, forecast, savedAt })
      .onConflictDoUpdate({ target: forecastBaselines.id, set: { forecast, savedAt } });
    return NextResponse.json({ saved_at: savedAt });
  } catch { return NextResponse.json({ error: "Baseline could not be saved. Apply migration 0021 if the baseline table is missing." }, { status: 503 }); }
}
