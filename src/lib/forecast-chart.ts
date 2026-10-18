import type { TimelineDay } from "./types";

export function threeMonthForecastDays(today = new Date()) {
  const end = new Date(today.getFullYear(), today.getMonth() + 3, 1);
  const lastDay = new Date(end.getFullYear(), end.getMonth() + 1, 0).getDate();
  end.setDate(Math.min(today.getDate(), lastDay));
  return Math.round((Date.UTC(end.getFullYear(), end.getMonth(), end.getDate()) -
    Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())) / 86_400_000) + 1;
}

export function balanceChartGeometry(timeline: Pick<TimelineDay, "balance">[]) {
  if (!timeline.length) return null;
  const balances = timeline.map(day => day.balance);
  const low = Math.min(0, ...balances);
  const high = Math.max(0, ...balances);
  const padding = Math.max((high - low) * 0.08, 100);
  const min = low - padding;
  const max = high + padding;
  const y = (balance: number) => 16 + (max - balance) / (max - min) * 188;
  const points = balances.map((balance, index) => ({
    x: balances.length === 1 ? 500 : index / (balances.length - 1) * 1000,
    y: y(balance),
  }));
  return { min, max, zeroY: y(0), points,
    path: points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x},${point.y}`).join(" ") };
}
