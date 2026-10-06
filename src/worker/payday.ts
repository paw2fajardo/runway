import { pathToFileURL } from "node:url";
import { processDueOccurrences } from "../lib/payday/posting";
import { deliverPendingPaydayNotifications } from "../lib/payday/push";
import { processDueAutoPayBills } from "../lib/bills/posting";

const DEFAULT_POLL_INTERVAL_MS = 60_000;

/** One idempotent polling cycle. Paycheck credits commit before push delivery starts. */
export async function runPaydayWorkerOnce(now = new Date()): Promise<{ posted: number; notificationsSent: number }> {
  const posted = await processDueOccurrences(now);
  try { await processDueAutoPayBills(now); }
  catch (error) { console.error("Auto-pay worker cycle failed:", error); }
  const notificationsSent = await deliverPendingPaydayNotifications({ now });
  return { posted, notificationsSent };
}

export async function runPaydayWorker(options: {
  pollIntervalMs?: number;
  runOnce?: (now: Date) => Promise<unknown>;
  now?: () => Date;
  sleep?: (milliseconds: number) => Promise<void>;
} = {}): Promise<void> {
  const interval = options.pollIntervalMs ?? Number(process.env.PAYDAY_POLL_INTERVAL_MS ?? DEFAULT_POLL_INTERVAL_MS);
  if (!Number.isInteger(interval) || interval < 1_000 || interval > 3_600_000) {
    throw new Error("PAYDAY_POLL_INTERVAL_MS must be between 1000 and 3600000.");
  }
  const runOnce = options.runOnce ?? runPaydayWorkerOnce;
  const sleep = options.sleep ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)));
  let stopping = false;
  const stop = () => { stopping = true; };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  try {
    while (!stopping) {
      try { await runOnce((options.now ?? (() => new Date()))()); }
      catch (error) {
        // A failed push/database poll is retried on the next cycle; a committed paycheck is idempotent.
        console.error("Payday worker cycle failed:", error instanceof Error ? error.message : "unknown error");
      }
      if (!stopping) await sleep(interval);
    }
  } finally {
    process.removeListener("SIGTERM", stop);
    process.removeListener("SIGINT", stop);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void runPaydayWorker().catch(error => {
    console.error("Payday worker stopped:", error instanceof Error ? error.message : "unknown error");
    process.exitCode = 1;
  });
}
