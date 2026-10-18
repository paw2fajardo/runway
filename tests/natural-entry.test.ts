import { afterEach, describe, expect, it, vi } from "vitest";
import { parseInboxText, parseNaturalExpense } from "../src/lib/ai-parser";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe("plain-language entry extraction", () => {
  it("extracts a peso expense and account hint without inventing a merchant", () => {
    expect(parseNaturalExpense("Spent ₱420 on groceries using GCash")).toMatchObject({
      amount_cents: 42000, merchant: "groceries", source_account_hint: "GCash", type: "expense" });
    expect(parseNaturalExpense("Paid PHP 1,500.50 for lunch with Checking")).toMatchObject({ amount_cents: 150050, source_account_hint: "Checking" });
  });
  it.each(["Spent -420 on groceries", "Spent 0 on groceries", "Spent 420 on groceries yesterday", "Spent 420 on 2 items", "Spent 99999999999999999 on lunch"])("leaves ambiguous entries for review: %s", value => {
    expect(parseNaturalExpense(value)).toBeNull();
  });
  it("does not mistake a reference or date for a payment amount or guess an account", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", ""); vi.stubEnv("AI_API_KEY", "");
    const parsed = await parseInboxText("Ref 123456 on 2026-10-18");
    expect(parsed.amount_cents).toBe(0);
    expect(parsed.source_account_hint).toBeUndefined();
    expect(parsed.confidence).toBe(0);
  });
  it("validates AI output and falls back safely on negative or non-integer money", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ choices: [{ message: { content: JSON.stringify({ merchant: "Lunch", amount_cents: -500, raw_summary: "Lunch" }) } }] })));
    expect((await parseInboxText("unreadable reference 123", "test-key")).amount_cents).toBe(0);
  });
  it("does not silently interpret shorthand or choose between multiple amounts", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", ""); vi.stubEnv("AI_API_KEY", "");
    expect((await parseInboxText("Paid ₱1k")).amount_cents).toBe(0);
    expect((await parseInboxText("PHP100 plus PHP200")).amount_cents).toBe(0);
  });
});
