import { stdin, stdout } from "node:process";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { ownerAuth, ownerSessions } from "../src/db/schema";
import { hashPassword } from "../src/lib/auth/password";

type HiddenInput = {
  isTTY?: boolean;
  setRawMode?: (mode: boolean) => void;
  on: (event: "data", listener: (chunk: Buffer | string) => void) => unknown;
  removeListener: (event: "data", listener: (chunk: Buffer | string) => void) => unknown;
  resume: () => unknown;
  pause: () => unknown;
};
type Output = Pick<NodeJS.WriteStream, "write">;

/** Read one line without echoing it to the terminal. Requires an interactive TTY. */
export function readHiddenPassword(
  input: HiddenInput = stdin,
  output: Output = stdout,
  prompt = "New owner password: ",
): Promise<string> {
  if (!input.isTTY || typeof input.setRawMode !== "function") {
    return Promise.reject(new Error("A TTY is required. Run this command with docker compose exec -it."));
  }

  output.write(prompt);
  input.setRawMode(true);
  input.resume();

  return new Promise((resolve, reject) => {
    let value = "";
    const cleanup = () => {
      input.removeListener("data", onData);
      input.setRawMode?.(false);
      input.pause();
      output.write("\n");
    };
    const onData = (chunk: Buffer | string) => {
      for (const char of chunk.toString("utf8")) {
        if (char === "\u0003") {
          cleanup();
          reject(new Error("Password reset cancelled."));
          return;
        }
        if (char === "\r" || char === "\n") {
          cleanup();
          resolve(value);
          return;
        }
        if (char === "\u007f" || char === "\b") {
          value = value.slice(0, -1);
        } else if (char >= " " && char !== "\u007f") {
          value += char;
        }
      }
    };
    input.on("data", onData);
  });
}

export async function updateOwnerPassword(password: string): Promise<void> {
  const passwordHash = await hashPassword(password);
  await db.transaction(async (tx) => {
    const [owner] = await tx.select({ id: ownerAuth.id }).from(ownerAuth).where(
      // The schema enforces the singleton, so its id is always one.
      eq(ownerAuth.id, 1),
    ).limit(1);
    if (!owner) throw new Error("Owner account has not been configured yet.");

    const now = new Date();
    await tx.update(ownerAuth).set({ passwordHash, updatedAt: now }).where(eq(ownerAuth.id, owner.id));
    await tx.update(ownerSessions).set({ revokedAt: now }).where(eq(ownerSessions.ownerId, owner.id));
  });
}

export async function runPasswordReset(
  input: HiddenInput = stdin,
  output: Output = stdout,
  update: (password: string) => Promise<void> = updateOwnerPassword,
): Promise<void> {
  const password = await readHiddenPassword(input, output);
  const confirmation = await readHiddenPassword(input, output, "Confirm new owner password: ");
  if (password !== confirmation) throw new Error("Passwords do not match.");
  await update(password);
}

function isDirectExecution(): boolean {
  return Boolean(process.argv[1]?.replaceAll("\\", "/").endsWith("/scripts/reset-owner-password.ts"));
}

if (isDirectExecution()) {
  runPasswordReset().then(() => {
    stdout.write("Owner password updated. All existing sessions were revoked.\n");
  }).catch((error: unknown) => {
    const safeErrors = new Set([
      "A TTY is required. Run this command with docker compose exec -it.",
      "Password reset cancelled.",
      "Passwords do not match.",
      "Password must be between 12 and 1024 characters",
      "Owner account has not been configured yet.",
    ]);
    const message = error instanceof Error && safeErrors.has(error.message)
      ? error.message
      : "Password reset failed. Check database connectivity and try again.";
    console.error(message);
    process.exitCode = 1;
  });
}
