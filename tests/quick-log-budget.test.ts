import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

const harness = vi.hoisted(() => ({ states: [] as unknown[], refs: [] as { current: unknown }[], effects: [] as (() => unknown)[], stateIndex: 0, refIndex: 0 }));
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual,
    useState: (initial: unknown) => {
      const index = harness.stateIndex++;
      if (!(index in harness.states)) harness.states[index] = typeof initial === "function" ? initial() : initial;
      return [harness.states[index], (value: unknown) => { harness.states[index] = typeof value === "function" ? value(harness.states[index]) : value; }];
    },
    useRef: (initial: unknown) => harness.refs[harness.refIndex++] ?? (harness.refs[harness.refIndex - 1] = { current: initial }),
    useEffect: (effect: () => unknown) => harness.effects.push(effect),
    useLayoutEffect: () => {},
  };
});
vi.mock("@/lib/offline-db", () => ({ queueOfflineTransaction: vi.fn() }));
vi.mock("@/lib/currency", () => ({ formatPHP: (cents: number) => `₱${(cents / 100).toFixed(2)}` }));
vi.mock("@/components/ui/Dialog", () => ({ Dialog: () => null }));
import { RapidExpenseDrawer } from "../src/components/quick-log/RapidExpenseDrawer";

type Node = ReactElement<{ children?: unknown; id?: string; "runway-id"?: string; value?: string; disabled?: boolean; onChange?: (event: { target: { value?: string; checked?: boolean } }) => void; onClick?: () => Promise<void> }>;
function render() {
  harness.stateIndex = 0; harness.refIndex = 0; harness.effects.length = 0;
  return RapidExpenseDrawer({ isOpen: true, onClose: vi.fn(), accounts: [{ id: "account", name: "Wallet", type: "cash", currentBalance: 100000 }] }) as Node;
}
function find(node: unknown, id: string): Node {
  if (Array.isArray(node)) { for (const item of node) { const result = find(item, id); if (result) return result; } }
  if (node && typeof node === "object" && "props" in node) {
    const element = node as Node;
    if (element.props.id === id || element.props["runway-id"] === id) return element;
    return find(element.props.children, id);
  }
  return undefined as unknown as Node;
}
afterEach(() => { harness.states.length = 0; harness.refs.length = 0; harness.effects.length = 0; vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("Quick log budget selection", () => {
  it.each([
    { date: "2026-10-23", finish: true },
    { date: "2026-11-06", finish: false },
  ])("submits $date with finish=$finish and retains its UUID after an error", async ({ date, finish }) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-12T04:00:00Z"));
    vi.stubGlobal("window", { setTimeout: vi.fn(), localStorage: { setItem: vi.fn() } });
    vi.stubGlobal("navigator", { onLine: true });
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => [{ id: "budget", name: "Groceries", occurrences: [
      { date: "2026-10-23", spentCents: 10000, remainingCents: 40000, isFinished: false },
      { date: "2026-11-06", spentCents: 0, remainingCents: 50000, isFinished: false },
    ] }] }).mockRejectedValueOnce(new Error("Retry this expense"))
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: "Retry this expense" }) }).mockResolvedValueOnce({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    let tree = render();
    harness.effects[5](); // Opening a new entry resets selection and its submitted payload.
    harness.effects[2](); // Fetch persisted occurrence spending.
    await vi.waitFor(() => expect(find(render(), "quick-log-budget").props.disabled).toBe(false));
    tree = render();
    find(tree, "quick-log-amount").props.onChange!({ target: { value: "250" } });
    find(tree, "quick-log-source-account").props.onChange!({ target: { value: "account" } });
    find(tree, "quick-log-budget").props.onChange!({ target: { value: `budget|${date}` } });
    tree = render();
    if (finish) find(tree, "quick-log-budget-finish").props.onChange!({ target: { checked: true } });
    await find(render(), "quick-log.confirm").props.onClick!();
    expect(find(render(), "quick-log.submit.error").props.children).toBe("Retry this expense");
    vi.setSystemTime(new Date("2026-10-12T04:01:00Z"));
    await find(render(), "quick-log.confirm").props.onClick!();
    find(render(), "quick-log-amount").props.onChange!({ target: { value: "300" } });
    vi.setSystemTime(new Date("2026-10-12T04:02:00Z"));
    await find(render(), "quick-log.confirm").props.onClick!();
    const payloads = fetchMock.mock.calls.slice(1).map((call) => JSON.parse(call[1].body));
    expect(payloads[0]).toMatchObject({ planned_budget_id: "budget", planned_budget_occurrence_date: date, finish_planned_budget_occurrence: finish, gross_outflow: 25000 });
    expect(payloads[0].idempotency_key).toMatch(/^[0-9a-f-]{36}$/);
    expect(payloads[1]).toEqual(payloads[0]);
    expect(payloads[2].gross_outflow).toBe(30000);
    expect(payloads[2].idempotency_key).not.toBe(payloads[0].idempotency_key);
    expect(payloads[2].transacted_at).toBe("2026-10-12T04:02:00.000Z");
  });
});
