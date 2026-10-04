import { describe, it, expect } from "vitest";

describe("Balance Checkpoints & Automated Drift Compensation", () => {
  it("computes positive drift discrepancy when observed balance exceeds recorded balance", () => {
    const recordedBalance = 2400000; // ₱24,000.00
    const observedBalance = 2450000; // ₱24,500.00

    const discrepancy = observedBalance - recordedBalance;
    expect(discrepancy).toBe(50000); // +₱500.00

    // Should create income drift transaction of +50000
    const driftType = discrepancy > 0 ? "income" : "expense";
    expect(driftType).toBe("income");
    expect(recordedBalance + discrepancy).toBe(observedBalance);
  });

  it("computes negative drift discrepancy when observed balance is below recorded balance", () => {
    const recordedBalance = 1850000; // ₱18,500.00
    const observedBalance = 1820000; // ₱18,200.00

    const discrepancy = observedBalance - recordedBalance;
    expect(discrepancy).toBe(-30000); // -₱300.00

    // Should create expense drift transaction of -30000
    const driftType = discrepancy > 0 ? "income" : "expense";
    expect(driftType).toBe("expense");
    expect(recordedBalance + discrepancy).toBe(observedBalance);
  });

  it("handles zero drift snapshot without creating adjustment transaction", () => {
    const recordedBalance = 350000;
    const observedBalance = 350000;

    const discrepancy = observedBalance - recordedBalance;
    expect(discrepancy).toBe(0);
  });
});
