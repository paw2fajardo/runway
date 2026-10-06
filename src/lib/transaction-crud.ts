export function isQuickLogEligible(type: string, legs: { accountId: string | null }[]) {
  const accountCount = legs.filter((leg) => leg.accountId !== null).length;
  return legs.length >= 2 && (type === "transfer" ? accountCount === 2 : (type === "income" || type === "expense") && accountCount === 1);
}

export function accountBalanceAdjustments(legs: { accountId: string | null; amount: number }[], direction: "reverse" | "apply") {
  const adjustments = new Map<string, number>();
  for (const leg of legs) if (leg.accountId) adjustments.set(leg.accountId, (adjustments.get(leg.accountId) ?? 0) + leg.amount * (direction === "reverse" ? -1 : 1));
  return adjustments;
}
