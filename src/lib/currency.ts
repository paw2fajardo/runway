/**
 * Currency utilities for LedgerFlow.
 * Enforces integer-cent/centavo monetary precision.
 * ₱1,500.50 is stored as 150050.
 */

export function formatPHP(cents: number | bigint, includeSymbol: boolean = true): string {
  const numeric = typeof cents === "bigint" ? Number(cents) : cents;
  const isNegative = numeric < 0;
  const absPesos = Math.abs(numeric) / 100;

  const formatted = absPesos.toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  const prefix = isNegative ? "-₱" : "₱";
  return includeSymbol ? `${prefix}${formatted}` : formatted;
}

export function formatCompactPHP(cents: number | bigint): string {
  const numeric = typeof cents === "bigint" ? Number(cents) : cents;
  const pesos = Math.abs(numeric) / 100;
  const sign = numeric < 0 ? "-" : "";

  if (pesos >= 1_000_000) {
    return `${sign}₱${(pesos / 1_000_000).toFixed(1)}M`;
  }
  if (pesos >= 1_000) {
    return `${sign}₱${(pesos / 1_000).toFixed(1)}k`;
  }
  return `${sign}₱${pesos.toFixed(0)}`;
}

export function parseCentString(digits: string): number {
  const clean = digits.replace(/[^\d]/g, "");
  return parseInt(clean || "0", 10);
}

export function pesosToCents(pesos: number): number {
  return Math.round(pesos * 100);
}

export function centsToPesos(cents: number): number {
  return cents / 100;
}
