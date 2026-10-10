import { afterEach, describe, expect, it, vi } from "vitest";
import { answerRunwayQuestion, getRunwayAssistantClientKey, RunwayAssistantError, RunwayAssistantRateLimiter } from "../src/lib/runway-assistant";
import type { RunwayForecastResponse } from "../src/lib/types";

const forecast: RunwayForecastResponse = {
  current_liquid_cash: 250000,
  confirmed_inflows: 100000,
  scheduled_bills_total: 50000,
  discretionary_burn_total: 25000,
  planned_spending_total: 0,
  net_projected_buffer: 275000,
  daily_allowance: 12500,
  days_to_payday: 5,
  next_payday_date: "2026-10-09",
  is_solvent: true,
  shortfall_date: null,
  shortfall_amount: 0,
  timeline: [],
};

afterEach(() => vi.unstubAllGlobals());

describe("answerRunwayQuestion", () => {
  it("returns a deterministic shortfall for the reported 45,000 item without calling OpenRouter", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const scenarioForecast = { ...forecast, net_projected_buffer: 549600 };

    const answer = await answerRunwayQuestion("can i buy a 45,000 item", scenarioForecast, "private-test-key");
    expect(answer).toContain("No.");
    expect(answer).toContain("₱39,504.00");
    expect(answer).toContain("₱5,496.00");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("allows a purchase only when the projected buffer covers it", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(answerRunwayQuestion("Can I afford a ₱1,000 item?", forecast, "private-test-key"))
      .resolves.toContain("Yes.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("parses a 45k shorthand as 45,000 pesos", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const scenarioForecast = { ...forecast, net_projected_buffer: 549600 };
    const answer = await answerRunwayQuestion("can i buy a 45k item", scenarioForecast, "private-test-key");
    expect(answer).toContain("No.");
    expect(answer).toContain("₱39,504.00");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses the explicit total rather than the item count", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const scenarioForecast = { ...forecast, net_projected_buffer: 549600 };
    const answer = await answerRunwayQuestion("Can I buy 2 items for ₱45,000?", scenarioForecast, "private-test-key");
    expect(answer).toContain("₱45,000.00 item");
    expect(answer).toContain("₱39,504.00");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["45,000 USD", "45,000$", "$45,000"])("asks for clarification on foreign currency %s", async (amount) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const answer = await answerRunwayQuestion(`Can I buy an item for ${amount}?`, forecast, "private-test-key");
    expect(answer).toMatch(/clarify|currency/i);
    expect(answer).not.toContain("Yes.");
    expect(answer).not.toContain("No.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("preserves the minus sign for an already-negative projected buffer", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const negativeForecast = { ...forecast, net_projected_buffer: -10000 };
    const answer = await answerRunwayQuestion("Can I buy a ₱1,000 item?", negativeForecast, "private-test-key");
    expect(answer).toContain("-₱100.00");
    expect(answer).toContain("₱1,100.00");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    { amount: "45,000.999", label: "too many decimal places" },
    { amount: "45,00", label: "malformed comma grouping" },
  ])("sends $label amount to OpenRouter unchanged", async ({ amount }) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: "Need more detail about the amount and currency." } }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(answerRunwayQuestion(`Can I buy a ${amount} item?`, forecast, "private-test-key"))
      .resolves.toBe("Need more detail about the amount and currency.");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("sends the server forecast to OpenRouter and returns its plain text answer", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: "After the purchase, your estimated buffer is about ₱1750." } }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(answerRunwayQuestion("What should I know about my buffer?", forecast, "private-test-key"))
      .resolves.toBe("After the purchase, your estimated buffer is about ₱1750.");

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer private-test-key");
    expect(JSON.parse(String(init.body)).messages[1].content).toContain(JSON.stringify(forecast));
  });

  it("fails clearly when the server key is missing", async () => {
    await expect(answerRunwayQuestion("Question?", forecast, ""))
      .rejects.toMatchObject({ code: "missing_key" });
  });

  it("returns a safe error for upstream failures without exposing response details", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("secret upstream detail", { status: 500 })));
    await expect(answerRunwayQuestion("Question?", forecast, "private-test-key"))
      .rejects.toMatchObject({ code: "upstream", message: "Runway AI is temporarily unavailable." });
  });
});

describe("RunwayAssistantRateLimiter", () => {
  it("limits each client within the window and reports the retry delay", () => {
    const limiter = new RunwayAssistantRateLimiter(2, 60_000, 10);
    expect(limiter.consume("client-a", 1000).allowed).toBe(true);
    expect(limiter.consume("client-a", 2000).allowed).toBe(true);
    expect(limiter.consume("client-a", 3000)).toEqual({ allowed: false, retryAfterSeconds: 58 });
    expect(limiter.consume("client-b", 3000).allowed).toBe(true);
    expect(limiter.consume("client-a", 61_001).allowed).toBe(true);
  });

  it("uses proxy client IP headers and falls back safely for malformed values", () => {
    expect(getRunwayAssistantClientKey(new Headers({ "x-real-ip": "203.0.113.8" }))).toBe("203.0.113.8");
    expect(getRunwayAssistantClientKey(new Headers({ "x-forwarded-for": "2001:db8::1, 10.0.0.1" }))).toBe("2001:db8::1");
    expect(getRunwayAssistantClientKey(new Headers({ "x-real-ip": "bad value" }))).toBe("unknown-client");
  });
});
