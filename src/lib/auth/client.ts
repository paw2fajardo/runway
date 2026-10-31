import { clearPrivatePageCaches } from "../../components/payday/NotificationSettings";
import { recoverSyncingToPending, waitForOfflineQueue } from "../offline-db";

const AUTH_LOCK_NAME = "runway-auth-cookie-mutation";
const AUTH_SESSION_EPOCH_KEY = "runway_auth_session_epoch";

/**
 * Record a successful login timestamp across tabs to coordinate with pending logouts.
 */
export function recordLoginSession(): void {
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(AUTH_SESSION_EPOCH_KEY, Date.now().toString());
    } catch {
      // Ignore storage access errors
    }
  }
}

/**
 * Get the latest recorded login epoch timestamp across tabs.
 */
export function getLastLoginEpoch(): number {
  if (typeof localStorage !== "undefined") {
    try {
      const val = localStorage.getItem(AUTH_SESSION_EPOCH_KEY);
      return val ? parseInt(val, 10) : 0;
    } catch {
      return 0;
    }
  }
  return 0;
}

/**
 * Coordinate cookie-mutating auth requests (login/logout) across tabs
 * using the Web Locks API when available to prevent race conditions.
 */
export async function coordinateAuthMutation<T>(action: () => Promise<T>): Promise<T> {
  if (typeof navigator !== "undefined" && navigator.locks?.request) {
    return navigator.locks.request(AUTH_LOCK_NAME, action);
  }
  return action();
}

/**
 * Signs the user out by coordinating with in-flight logins, invalidating the session
 * on the server, purging private client caches and lingering syncing state, and
 * redirecting to the login screen.
 *
 * Ambiguous responses (network dropped, timeout, 5xx) are handled by still clearing
 * local private state and redirecting to /login rather than leaving the user stranded.
 */
export async function signOut(): Promise<void> {
  const initialEpoch = getLastLoginEpoch();

  // Wait for any active offline queue flush to finish and restore syncing state
  await waitForOfflineQueue(2000).catch(() => undefined);
  await recoverSyncingToPending().catch(() => undefined);

  await coordinateAuthMutation(async () => {
    const currentEpoch = getLastLoginEpoch();

    // If another tab logged in while we prepared or waited for the lock,
    // skip the logout request so its response won't erase the newer session cookie.
    if (currentEpoch <= initialEpoch) {
      try {
        await fetch("/api/auth/logout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });
      } catch {
        // Network failure / lost response: proceed with client cleanup and redirect
      }
    }

    try {
      await clearPrivatePageCaches();
    } catch {
      // Ignore cache clearing failures
    }

    // Recover any lingering syncing transactions back to pending before redirect
    await recoverSyncingToPending().catch(() => undefined);

    if (typeof window !== "undefined") {
      window.location.assign("/login");
    }
  });
}
