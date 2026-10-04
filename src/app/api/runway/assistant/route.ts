import { NextRequest, NextResponse } from "next/server";
import { GET as getForecast } from "@/app/api/runway/forecast/route";
import { answerRunwayQuestion, getRunwayAssistantClientKey, RunwayAssistantError, RunwayAssistantRateLimiter } from "@/lib/runway-assistant";
import type { RunwayForecastResponse } from "@/lib/types";
import { z } from "zod";

const RequestSchema = z.object({ query: z.string().trim().min(1).max(1000) }).strict();
const rateLimiter = new RunwayAssistantRateLimiter(5, 60_000, 5_000);

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Send a valid JSON request." }, { status: 400 });
  }

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter a question up to 1,000 characters." }, { status: 400 });
  }

  const limit = rateLimiter.consume(getRunwayAssistantClientKey(req.headers));
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many Runway AI questions. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  try {
    const forecastResponse = await getForecast(new NextRequest(new URL("/api/runway/forecast", req.url)));
    if (!forecastResponse.ok) {
      return NextResponse.json({ error: "Runway forecast is not available yet." }, { status: 503 });
    }
    const forecast = await forecastResponse.json() as RunwayForecastResponse;
    const answer = await answerRunwayQuestion(parsed.data.query, forecast);
    return NextResponse.json({ answer });
  } catch (error: unknown) {
    if (error instanceof RunwayAssistantError) {
      const status = error.code === "missing_key" ? 503 : 502;
      return NextResponse.json({ error: error.message }, { status });
    }
    return NextResponse.json({ error: "Unable to answer this Runway question." }, { status: 500 });
  }
}
