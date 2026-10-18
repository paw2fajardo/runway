import { NextRequest, NextResponse } from "next/server";
import { GET as getForecast } from "../forecast/route";
import { answerRunwayQuestion, getRunwayAssistantClientKey, RunwayAssistantError, RunwayAssistantRateLimiter } from "../../../../lib/runway-assistant";
import type { RunwayForecastResponse } from "../../../../lib/types";
import { z } from "zod";
import { assertSameOrigin, requireOwner } from "../../../../lib/auth/guard";
import { todayInManila } from "../../../../lib/bills/due-date";
import { loadInsights } from "../../../../lib/load-insights";

const RequestSchema = z.object({ query: z.string().trim().min(1).max(1000),
  plan_scenario: z.enum(["current", "spending", "grace", "combined"]).optional(),
  use_grace_periods: z.boolean().default(false),
  insights: z.boolean().default(false),
}).strict().refine(value => !["grace", "combined"].includes(value.plan_scenario ?? "") || value.use_grace_periods);
const rateLimiter = new RunwayAssistantRateLimiter(5, 60_000, 5_000);

export async function POST(req: NextRequest) {
  const originError = assertSameOrigin(req);
  if (originError) return originError;
  const owner = await requireOwner(req);
  if (owner instanceof Response) return owner;
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
    const forecastUrl = new URL("/api/runway/forecast", req.url);
    if (parsed.data.plan_scenario) {
      forecastUrl.search = new URLSearchParams({ horizon_days: "45", reference_date: todayInManila(),
        payment_plan: "true", use_grace_periods: String(parsed.data.use_grace_periods) }).toString();
    }
    const forecastResponse = await getForecast(new NextRequest(forecastUrl, { headers: req.headers }));
    if (!forecastResponse.ok) {
      return NextResponse.json({ error: "Runway forecast is not available yet." }, { status: 503 });
    }
    const forecast = await forecastResponse.json() as RunwayForecastResponse;
    if (parsed.data.plan_scenario) {
      if (!forecast.payment_plan?.scenarios.some(item => item.id === parsed.data.plan_scenario)) {
        return NextResponse.json({ error: "Payment plan is not available yet." }, { status: 503 });
      }
      forecast.payment_plan.scenarios = forecast.payment_plan.scenarios.filter(item => item.id === parsed.data.plan_scenario);
    }
    const question = parsed.data.plan_scenario
      ? `Explain the server-calculated payment_plan scenario with id "${parsed.data.plan_scenario}". ${parsed.data.query}`
      : parsed.data.query;
    const insights = parsed.data.insights ? await loadInsights() : undefined;
    const answer = await answerRunwayQuestion(question, forecast, undefined, insights
      ? { weekly: insights.weekly, recurring: insights.recurring, variable_bills: insights.variable_bills,
        history_from_date: insights.history_from_date, history_truncated: insights.history_truncated } : undefined);
    return NextResponse.json({ answer });
  } catch (error: unknown) {
    if (error instanceof RunwayAssistantError) {
      const status = error.code === "missing_key" ? 503 : 502;
      return NextResponse.json({ error: error.message }, { status });
    }
    return NextResponse.json({ error: "Unable to answer this Runway question." }, { status: 500 });
  }
}
