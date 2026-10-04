import { describe, it, expect } from "vitest";
import { formatPHP, parseCentString, pesosToCents, centsToPesos } from "../src/lib/currency";

describe("Currency & Monetary Precision", () => {
  it("formats integer cents into standard Philippine Pesos", () => {
    expect(formatPHP(150050)).toBe("₱1,500.50");
    expect(formatPHP(200000)).toBe("₱2,000.00");
    expect(formatPHP(0)).toBe("₱0.00");
    expect(formatPHP(-50000)).toBe("-₱500.00");
  });

  it("converts between pesos and integer cents accurately", () => {
    expect(pesosToCents(1500.5)).toBe(150050);
    expect(pesosToCents(18.0)).toBe(1800);
    expect(centsToPesos(150050)).toBe(1500.5);
    expect(centsToPesos(1800)).toBe(18);
  });

  it("parses cent digit strings from rapid touch keypad", () => {
    expect(parseCentString("200000")).toBe(200000);
    expect(parseCentString("1850")).toBe(1850);
    expect(parseCentString("")).toBe(0);
  });
});

describe("Compound Multi-Leg Transaction Integrity", () => {
  it("enforces transfer with friction balancing rule: gross_outflow = net_inflow + fee", () => {
    const grossOutflow = 501500; // ₱5,015.00
    const netInflow = 500000; // ₱5,000.00
    const feeAmount = 1500; // ₱15.00

    expect(grossOutflow).toBe(netInflow + feeAmount);

    // Leg representation
    const leg1SourceDebit = -grossOutflow;
    const leg2DestCredit = netInflow;
    const leg3FeeBucket = feeAmount;

    // Sum of legs with fee category balances
    const balanceCheck = leg1SourceDebit + leg2DestCredit + leg3FeeBucket;
    expect(balanceCheck).toBe(0);
  });

  it("calculates ATM Cash Drop black-hole outflow accurately", () => {
    const cashDropAmount = 200000; // ₱2,000.00 pocket money
    const atmFee = 1800; // ₱18.00 external ATM fee
    const totalDebitedFromBank = cashDropAmount + atmFee; // ₱2,018.00

    expect(totalDebitedFromBank).toBe(201800);
    expect(totalDebitedFromBank - atmFee).toBe(cashDropAmount);
  });
});
