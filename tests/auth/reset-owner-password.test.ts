import { PassThrough } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const tx = {
    select: vi.fn(),
    update: vi.fn(),
  };
  const db = { transaction: vi.fn(async (callback: (transaction: typeof tx) => Promise<void>) => callback(tx)) };
  return { tx, db, hashPassword: vi.fn(async (password: string) => `encoded:${password}`) };
});

vi.mock("../../src/db", () => ({ db: mocks.db }));
vi.mock("../../src/lib/auth/password", () => ({ hashPassword: mocks.hashPassword }));

import { ownerAuth, ownerSessions } from "../../src/db/schema";
import { readHiddenPassword, runPasswordReset, updateOwnerPassword } from "../../scripts/reset-owner-password";

function setupDb(ownerId: number | undefined) {
  const selectLimit = vi.fn().mockResolvedValue(ownerId === undefined ? [] : [{ id: ownerId }]);
  const selectWhere = vi.fn(() => ({ limit: selectLimit }));
  const selectFrom = vi.fn(() => ({ where: selectWhere }));
  mocks.tx.select.mockReturnValue({ from: selectFrom });

  const updates: Array<{ table: unknown; values: unknown; predicate: unknown }> = [];
  mocks.tx.update.mockImplementation((table: unknown) => ({
    set: (values: unknown) => ({
      where: async (predicate: unknown) => { updates.push({ table, values, predicate }); },
    }),
  }));
  return { updates, selectWhere, selectLimit };
}

function makeTty(firstPassword = "a-new-long-password", confirmationPassword = firstPassword) {
  const input = new PassThrough() as PassThrough & { isTTY: boolean; setRawMode: (enabled: boolean) => void };
  input.isTTY = true;
  const rawModeCalls: boolean[] = [];
  input.setRawMode = (enabled) => rawModeCalls.push(enabled);
  let text = "";
  const output = {
    write(chunk: string) {
      text += chunk;
      const prompt = chunk.includes("Confirm") ? "confirm" : chunk.includes("password") ? "first" : null;
      if (prompt) queueMicrotask(() => input.write(`${prompt === "first" ? firstPassword : confirmationPassword}\n`));
      return true;
    },
  };
  return { input, output, rawModeCalls, outputText: () => text };
}

describe("Docker owner password reset", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reads a password without echoing it and restores terminal mode", async () => {
    const input = new PassThrough() as PassThrough & { isTTY: boolean; setRawMode: (enabled: boolean) => void };
    input.isTTY = true;
    const rawModeCalls: boolean[] = [];
    input.setRawMode = (enabled) => rawModeCalls.push(enabled);
    let outputText = "";
    const result = readHiddenPassword(input, { write: (chunk) => { outputText += chunk; return true; } });
    input.write("secret-passphrase\n");

    await expect(result).resolves.toBe("secret-passphrase");
    expect(outputText).toBe("New owner password: \n");
    expect(rawModeCalls).toEqual([true, false]);
  });

  it("updates the singleton password and revokes every existing session", async () => {
    const { updates } = setupDb(1);

    await updateOwnerPassword("a-new-long-password");

    expect(mocks.hashPassword).toHaveBeenCalledWith("a-new-long-password");
    expect(updates).toHaveLength(2);
    expect(updates[0].table).toBe(ownerAuth);
    expect(updates[0].values).toMatchObject({ passwordHash: "encoded:a-new-long-password" });
    expect(updates[1].table).toBe(ownerSessions);
    expect(updates[1].values).toHaveProperty("revokedAt");
  });

  it("does not update anything if initial owner setup has not happened", async () => {
    setupDb(undefined);

    await expect(updateOwnerPassword("a-new-long-password")).rejects.toThrow("Owner account has not been configured yet.");
    expect(mocks.tx.update).not.toHaveBeenCalled();
  });

  it("requires matching entries and never echoes either password", async () => {
    const { input, output, outputText } = makeTty();
    const update = vi.fn(async () => undefined);

    await runPasswordReset(input, output, update);

    expect(update).toHaveBeenCalledWith("a-new-long-password");
    expect(outputText()).not.toContain("a-new-long-password");
  });

  it("rejects mismatched entries without updating the owner", async () => {
    const { input, output, outputText } = makeTty("first-password-value", "different-password-value");
    const update = vi.fn(async () => undefined);

    await expect(runPasswordReset(input, output, update)).rejects.toThrow("Passwords do not match.");

    expect(update).not.toHaveBeenCalled();
    expect(outputText()).not.toContain("first-password-value");
    expect(outputText()).not.toContain("different-password-value");
  });

  it("rejects non-interactive input instead of accepting a command-line password", async () => {
    const input = new PassThrough() as PassThrough & { isTTY: boolean };
    input.isTTY = false;
    await expect(readHiddenPassword(input, { write: () => true })).rejects.toThrow("A TTY is required");
  });
});
