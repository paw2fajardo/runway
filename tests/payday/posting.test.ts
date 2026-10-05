import { beforeEach, describe, expect, it } from "vitest";
import {
  processDueOccurrences,
  type OccurrencePostingStore,
  type OccurrenceTransaction,
  type PostingAccount,
  type PostingOccurrence,
  type PostingStream,
} from "../../src/lib/payday/posting";
import type { DuePaycheck } from "../../src/lib/payday/occurrences";

const now = new Date("2026-10-15T03:00:00.000Z");
const scheduled: DuePaycheck = {
  kind: "scheduled", incomeStreamId: "stream-1", dueDate: "2026-10-15",
  accountId: "account-1", amount: 125000,
};

class MemoryPostingStore implements OccurrencePostingStore {
  stream: PostingStream = {
    id: "stream-1", name: "Main salary", isEnabled: true, scheduleKind: "monthly",
    paydayAnchor: "2026-01-15", accountId: "account-1", netPayCents: 125000,
  };
  account: PostingAccount = { id: "account-1", name: "Payroll", type: "liquid", isActive: true };
  occurrences: PostingOccurrence[] = [];
  categoryIncome: boolean | null = null;
  balance = 500000;
  transactions: { id: string; name: string }[] = [];
  legs: { transactionId: string; accountId?: string; categoryId?: string; amount: number }[] = [];
  private serial: Promise<void> = Promise.resolve();

  async transaction<T>(work: (tx: OccurrenceTransaction) => Promise<T>): Promise<T> {
    let release!: () => void;
    const prior = this.serial;
    this.serial = new Promise<void>(resolve => { release = resolve; });
    await prior;
    const snapshot = structuredClone({ occurrences: this.occurrences, categoryIncome: this.categoryIncome,
      balance: this.balance, transactions: this.transactions, legs: this.legs });
    const tx: OccurrenceTransaction = {
      lockStream: async (id, includeDisabled = false) => id === this.stream.id && (includeDisabled || this.stream.isEnabled) ? this.stream : null,
      lockOccurrence: async id => this.occurrences.find(row => row.id === id) ?? null,
      lockParent: async id => this.occurrences.find(row => row.id === id) ?? null,
      lockAccount: async id => id === this.account.id ? this.account : null,
      claimScheduled: async (stream, dueDate, account) => {
        if (this.occurrences.some(row => row.kind === "scheduled" && row.id === `${stream.id}:${dueDate}`)) return null;
        const row: PostingOccurrence = { id: `${stream.id}:${dueDate}`, incomeStreamId: stream.id, kind: "scheduled", transactionId: null,
          retryDate: null, accountId: account.id, amountSnapshot: stream.netPayCents, parentOccurrenceId: null, status: "pending_confirmation" };
        this.occurrences.push(row);
        return row;
      },
      ensureSalaryCategory: async () => {
        if (this.categoryIncome === false) throw new Error("Salary category is unavailable or is not an income category.");
        this.categoryIncome = true;
        return "salary-category";
      },
      createTransaction: async name => {
        const id = `tx-${this.transactions.length + 1}`;
        this.transactions.push({ id, name });
        return id;
      },
      createLegs: async (transactionId, accountId, categoryId, amount) => {
        this.legs.push({ transactionId, accountId, amount }, { transactionId, categoryId, amount: -amount });
      },
      creditAccount: async (_accountId, amount) => { this.balance += amount; },
      markPosted: async (occurrenceId, transactionId, account, amount) => {
        const row = this.occurrences.find(item => item.id === occurrenceId)!;
        Object.assign(row, { transactionId, accountId: account.id, amountSnapshot: amount, status: "pending_confirmation" });
      },
    };
    try { return await work(tx); }
    catch (error) {
      Object.assign(this, snapshot);
      throw error;
    } finally { release(); }
  }
}

describe("payday posting", () => {
  let store: MemoryPostingStore;
  beforeEach(() => { store = new MemoryPostingStore(); });

  it("creates an income transaction, balanced legs, occurrence, and account credit", async () => {
    const count = await processDueOccurrences(now, { getDue: async () => [scheduled], store });
    expect(count).toBe(1);
    expect(store.categoryIncome).toBe(true);
    expect(store.balance).toBe(625000);
    expect(store.transactions).toHaveLength(1);
    expect(store.legs).toEqual([
      { transactionId: "tx-1", accountId: "account-1", amount: 125000 },
      { transactionId: "tx-1", categoryId: "salary-category", amount: -125000 },
    ]);
    expect(store.occurrences[0]).toMatchObject({ transactionId: "tx-1", status: "pending_confirmation", amountSnapshot: 125000 });
  });

  it("rolls back occurrence claim and all financial writes when category validation fails", async () => {
    store.categoryIncome = false;
    await expect(processDueOccurrences(now, { getDue: async () => [scheduled], store })).rejects.toThrow("Salary category");
    expect(store.occurrences).toHaveLength(0);
    expect(store.transactions).toHaveLength(0);
    expect(store.legs).toHaveLength(0);
    expect(store.balance).toBe(500000);
  });

  it("claims a scheduled key once across duplicate and concurrent runs", async () => {
    const getDue = async () => [scheduled];
    const counts = await Promise.all([
      processDueOccurrences(now, { getDue, store }),
      processDueOccurrences(now, { getDue, store }),
      processDueOccurrences(now, { getDue, store }),
    ]);
    expect(counts.reduce((sum, count) => sum + count, 0)).toBe(1);
    expect(store.balance).toBe(625000);
    expect(store.transactions).toHaveLength(1);
    expect(await processDueOccurrences(now, { getDue, store })).toBe(0);
  });

  it("posts a persisted retry from its snapshot without creating a scheduled key", async () => {
    const parent: PostingOccurrence = {
      id: "parent-1", incomeStreamId: "stream-1", kind: "scheduled", transactionId: "tx-original",
      retryDate: null, accountId: "account-1", amountSnapshot: 100000, parentOccurrenceId: null,
      status: "reversed_awaiting_retry",
    };
    const retry: PostingOccurrence = {
      id: "retry-1", incomeStreamId: "stream-1", kind: "retry", transactionId: null,
      retryDate: "2026-10-15", accountId: "account-1", amountSnapshot: 100000,
      parentOccurrenceId: parent.id, status: "pending_confirmation",
    };
    store.occurrences.push(parent, retry);
    const candidate: DuePaycheck = {
      kind: "retry", occurrenceId: retry.id, incomeStreamId: "stream-1", dueDate: retry.retryDate!,
      accountId: retry.accountId, amount: retry.amountSnapshot,
    };
    expect(await processDueOccurrences(now, { getDue: async () => [candidate], store })).toBe(1);
    expect(store.balance).toBe(600000);
    expect(store.transactions).toHaveLength(1);
    expect(store.transactions[0].name).toBe("Main salary");
    expect(store.occurrences.find(row => row.id === retry.id)?.transactionId).toBe("tx-1");
    expect(store.occurrences.filter(row => row.kind === "scheduled")).toHaveLength(1);
  });

  it("does not consume the scheduled key for inactive or non-liquid accounts", async () => {
    store.account.isActive = false;
    expect(await processDueOccurrences(now, { getDue: async () => [scheduled], store })).toBe(0);
    expect(store.occurrences).toHaveLength(0);
    store.account.isActive = true;
    store.account.type = "revolving_credit";
    expect(await processDueOccurrences(now, { getDue: async () => [scheduled], store })).toBe(0);
    expect(store.occurrences).toHaveLength(0);
    expect(store.balance).toBe(500000);
  });
});
