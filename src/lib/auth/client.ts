import { clearPrivatePageCaches } from "../../components/payday/NotificationSettings";

/**
 * Signs the user out by invalidating the session on the server,
 * purging cached client responses, and redirecting to the login screen.
 */
export async function signOut(): Promise<void> {
  const response = await fetch("/api/auth/logout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "Unable to sign out.");
  }
  await clearPrivatePageCaches().catch(() => undefined);
  if (typeof window !== "undefined") {
    window.location.assign("/login");
  }
}
