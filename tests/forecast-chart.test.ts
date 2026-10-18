import { describe, expect, it } from "vitest";
import { balanceChartGeometry, threeMonthForecastDays } from "../src/lib/forecast-chart";

describe("forecast chart", () => {
  it.each([
    [2026, 9, 18, 93],
    [2026, 10, 30, 91],
    [2027, 10, 30, 92],
    [2026, 0, 31, 90],
  ])("uses three calendar months with an inclusive, clamped end date from %i-%i-%i", (year, month, day, days) => {
    expect(threeMonthForecastDays(new Date(year, month, day))).toBe(days);
  });

  it("plots every daily balance in order and puts negative balances below zero", () => {
    const data = [{ balance: 10000 }, { balance: -5000 }, { balance: 0 }, { balance: 25000 }];
    const chart = balanceChartGeometry(data)!;
    expect(chart.points).toHaveLength(data.length);
    expect(chart.points[0].x).toBe(0);
    expect(chart.points.at(-1)?.x).toBe(1000);
    expect(chart.points[0].y).toBeLessThan(chart.zeroY);
    expect(chart.points[1].y).toBeGreaterThan(chart.zeroY);
    expect(chart.points[2].y).toBe(chart.zeroY);
    expect(chart.points[3].y).toBeLessThan(chart.points[0].y);
  });

  it.each([[0, 0], [100, 100], [-100, -100], [0]])("handles a flat or one-day forecast %j", (...balances) => {
    const chart = balanceChartGeometry(balances.map(balance => ({ balance })))!;
    expect(chart.max).toBeGreaterThan(chart.min);
    expect(chart.zeroY).toBeGreaterThan(0);
    expect(chart.zeroY).toBeLessThan(220);
    expect(chart.points.every(point => Number.isFinite(point.x) && Number.isFinite(point.y))).toBe(true);
    expect(chart.path).not.toMatch(/NaN|Infinity/);
  });

  it("handles an empty forecast", () => {
    expect(balanceChartGeometry([])).toBeNull();
  });
});
