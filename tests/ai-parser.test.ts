import { describe, it, expect } from "vitest";
import { parsePhilippineAlertHeuristic } from "../src/lib/ai-parser";

describe("Deterministic Philippine SMS & Alert Heuristic Parser", () => {
  it("parses BPI InstaPay transfer with convenience fee", () => {
    const raw = "InstaPay transfer of PHP 5,000.00 to GCash successful. Fee: PHP 15.00. Ref No: 994821";
    const parsed = parsePhilippineAlertHeuristic(raw);

    expect(parsed).not.toBeNull();
    expect(parsed?.amount_cents).toBe(500000);
    expect(parsed?.fee_cents).toBe(1500);
    expect(parsed?.type).toBe("transfer");
    expect(parsed?.destination_account_hint).toBe("GCash");
  });

  it("parses ATM cash withdrawal with surcharge", () => {
    const raw = "ATM withdrawal of PHP 2,000.00 at BDO ATM. Fee: PHP 18.00.";
    const parsed = parsePhilippineAlertHeuristic(raw);

    expect(parsed).not.toBeNull();
    expect(parsed?.amount_cents).toBe(200000);
    expect(parsed?.fee_cents).toBe(1800);
    expect(parsed?.type).toBe("expense");
    expect(parsed?.category_hint).toBe("Cash Outflow / Pocket Money");
  });

  it("parses utility bill notification (Meralco)", () => {
    const raw = "Your Meralco bill for Oct 2026 is PHP 2,850.00 due on 10/06/2026.";
    const parsed = parsePhilippineAlertHeuristic(raw);

    expect(parsed).not.toBeNull();
    expect(parsed?.amount_cents).toBe(285000);
    expect(parsed?.merchant).toBe("Meralco Bill");
    expect(parsed?.category_hint).toBe("Utilities & Telecom");
  });

  it("parses merchant POS debit card purchase", () => {
    const raw = "You paid PHP 185.00 at Artisan Brew on 10/03/2026. Card ending 9281";
    const parsed = parsePhilippineAlertHeuristic(raw);

    expect(parsed).not.toBeNull();
    expect(parsed?.amount_cents).toBe(18500);
    expect(parsed?.merchant).toBe("Artisan Brew");
    expect(parsed?.category_hint).toBe("Food & Groceries");
  });
});
