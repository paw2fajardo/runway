import { beforeEach, describe, expect, it } from "vitest";
import {
  confirmPaycheck, markPaycheckMissed,
  type ConfirmationOccurrence, type ConfirmationStore, type ConfirmationTransaction, type OriginalLeg,
} from "../../src/lib/payday/confirmation";
import {
  processDueOccurrences,
  type OccurrencePostingStore,
  type OccurrenceTransaction,
  type PostingAccount,
  type PostingOccurrence,
  type PostingStream,
} from "../../src/lib/payday/posting";

const now = new Date("2026-10-15T01:00:00.000Z");

class MemoryStore implements ConfirmationStore {
  rows: ConfirmationOccurrence[] = [];
  legsByTransaction = new Map<string, OriginalLeg[]>();
  transactions: { id: string; description: string }[] = [];
  balances = new Map<string, number>([["account-1", 100_000]]);
  serial: Promise<void> = Promise.resolve();

  async transaction<T>(work: (tx: ConfirmationTransaction) => Promise<T>): Promise<T> {
    let release!: () => void;
    const previous = this.serial;
    this.serial = new Promise<void>(resolve => { release = resolve; });
    await previous;
    const snapshot = structuredClone({ rows: this.rows, legsByTransaction: this.legsByTransaction,
      transactions: this.transactions, balances: this.balances });
    const tx: ConfirmationTransaction = {
      lockOccurrence: async id => this.rows.find(row => row.id === id) ?? null,
      getOriginalLegs: async transactionId => this.legsByTransaction.get(transactionId) ?? [],
      setConfirmed: async id => { this.rows.find(row => row.id === id)!.status = "confirmed"; },
      createReversal: async description => {
        const id = `reversal-${this.transactions.length + 1}`;
        this.transactions.push({ id, description });
        return id;
      },
      createReversalLegs: async (transactionId, legs) => {
        this.legsByTransaction.set(transactionId, legs.map(leg => ({ ...leg, amount: -leg.amount })));
      },
      applyBalanceDelta: async (accountId, delta) => { this.balances.set(accountId, (this.balances.get(accountId) ?? 0) + delta); },
      markReversed: async (id, reversalTransactionId) => {
        Object.assign(this.rows.find(row => row.id === id)!, { status: "reversed_awaiting_retry", reversalTransactionId });
      },
      createRetry: async (parent, retryDate) => {
        if (this.rows.some(row => row.kind === "retry" && row.parentOccurrenceId === parent.id && row.retryDate === retryDate)) return;
        this.rows.push({ ...parent, id: `retry-${this.rows.length}`, kind: "retry", dueDate: retryDate,
          retryDate, transactionId: null, status: "pending_confirmation", parentOccurrenceId: parent.id,
          reversalTransactionId: null });
      },
    };
    try { return await work(tx); }
    catch (error) {
      Object.assign(this, snapshot);
      throw error;
    } finally { release(); }
  }
}

function postedOccurrence(id = "occ-1", overrides: Partial<ConfirmationOccurrence> = {}): ConfirmationOccurrence {
  return { id, incomeStreamId: "stream-1", kind: "scheduled", dueDate: "2026-10-15", retryDate: null,
    accountId: "account-1", accountNameSnapshot: "Payroll", amountSnapshot: 50_000, transactionId: `tx-${id}`,
    status: "pending_confirmation", parentOccurrenceId: null, reversalTransactionId: null, ...overrides };
}

describe("payday confirmation", () => {
  let store: MemoryStore;
  beforeEach(() => { store = new MemoryStore(); });

  it("marks Received once and returns an idempotent result on repeats", async () => {
    store.rows.push(postedOccurrence());
    expect(await confirmPaycheck("occ-1", now, store)).toBe("confirmed");
    expect(await confirmPaycheck("occ-1", now, store)).toBe("already_confirmed");
    expect(store.rows[0].status).toBe("confirmed");
  });

  it("rejects Received for an unposted retry and leaves it eligible for worker posting", async () => {
    const parent = postedOccurrence("parent-1", { status: "reversed_awaiting_retry" });
    const retry = postedOccurrence("retry-1", { kind: "retry", dueDate: "2026-10-16", retryDate: "2026-10-16",
      parentOccurrenceId: parent.id, transactionId: null });
    store.rows.push(parent, retry);
    expect(await confirmPaycheck(retry.id, now, store)).toBe("invalid_state");
    expect(retry.status).toBe("pending_confirmation");
    expect(retry.transactionId).toBeNull();

    const account: PostingAccount = { id: retry.accountId!, name: "Payroll", type: "liquid", isActive: true };
    const stream: PostingStream = { id: retry.incomeStreamId, name: "Main salary", isEnabled: false,
      scheduleKind: "monthly", paydayAnchor: "2026-10-15", accountId: "other-account", netPayCents: 90_000 };
    const postingTransaction: OccurrenceTransaction = {
      lockStream: async id => id === stream.id ? stream : null,
      lockOccurrence: async id => id === retry.id ? retry as PostingOccurrence : null,
      lockParent: async id => id === parent.id ? parent as PostingOccurrence : null,
      lockAccount: async id => id === account.id ? account : null,
      claimScheduled: async () => null,
      ensureSalaryCategory: async () => "salary-category",
      createTransaction: async () => "tx-retry",
      createLegs: async () => undefined,
      creditAccount: async () => undefined,
      markPosted: async (id, transactionId) => { Object.assign(store.rows.find(row => row.id === id)!, { transactionId, status: "pending_confirmation" }); },
    };
    const postingStore: OccurrencePostingStore = { transaction: work => work(postingTransaction) };
    const posted = await processDueOccurrences(new Date("2026-10-16T01:00:00.000Z"), {
      getDue: async () => [{ kind: "retry", occurrenceId: retry.id, incomeStreamId: retry.incomeStreamId,
        dueDate: "2026-10-16", accountId: retry.accountId, amount: retry.amountSnapshot }],
      store: postingStore,
    });
    expect(posted).toBe(1);
    expect(retry).toMatchObject({ status: "pending_confirmation", transactionId: "tx-retry" });
  });

  it("reverses the posted credit atomically and creates a snapshot-based retry", async () => {
    store.rows.push(postedOccurrence());
    store.legsByTransaction.set("tx-occ-1", [
      { accountId: "account-1", categoryId: null, amount: 50_000 },
      { accountId: null, categoryId: "salary-category", amount: -50_000 },
    ]);
    expect(await markPaycheckMissed("occ-1", "2026-10-16", now, store)).toBe("confirmed");
    expect(store.balances.get("account-1")).toBe(50_000);
    expect(store.legsByTransaction.get("reversal-1")).toEqual([
      { accountId: "account-1", categoryId: null, amount: -50_000 },
      { accountId: null, categoryId: "salary-category", amount: 50_000 },
    ]);
    expect(store.rows[0]).toMatchObject({ status: "reversed_awaiting_retry", reversalTransactionId: "reversal-1" });
    expect(store.rows[1]).toMatchObject({ kind: "retry", parentOccurrenceId: "occ-1", retryDate: "2026-10-16",
      accountId: "account-1", accountNameSnapshot: "Payroll", amountSnapshot: 50_000 });
  });

  it("rejects today, malformed dates, missing transactions, and prevents duplicate reversal", async () => {
    const row = postedOccurrence();
    store.rows.push(row);
    expect(await markPaycheckMissed("occ-1", "2026-10-15", now, store)).toBe("invalid_date");
    expect(await markPaycheckMissed("occ-1", "2026-02-30", now, store)).toBe("invalid_date");
    expect(await markPaycheckMissed("missing", "2026-10-16", now, store)).toBe("not_found");
    expect(await markPaycheckMissed("occ-1", "2026-10-16", now, store)).toBe("invalid_state");
    expect(store.transactions).toHaveLength(0);
  });

  it("supports a missed retry becoming the parent of its next retry", async () => {
    const retry = postedOccurrence("retry-1", { kind: "retry", dueDate: "2026-10-16", retryDate: "2026-10-16",
      parentOccurrenceId: "occ-1", transactionId: "tx-retry-1" });
    store.rows.push(retry);
    store.legsByTransaction.set("tx-retry-1", [
      { accountId: "account-1", categoryId: null, amount: 50_000 },
      { accountId: null, categoryId: "salary-category", amount: -50_000 },
    ]);
    expect(await markPaycheckMissed("retry-1", "2026-10-17", now, store)).toBe("confirmed");
    expect(store.rows[1]).toMatchObject({ kind: "retry", parentOccurrenceId: "retry-1", retryDate: "2026-10-17" });
  });
});
