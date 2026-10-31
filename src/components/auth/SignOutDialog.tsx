"use client";

import React, { useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { signOut } from "@/lib/auth/client";

interface SignOutDialogProps {
  open: boolean;
  onClose: () => void;
  confirmRunwayId?: string;
  cancelRunwayId?: string;
}

export function SignOutDialog({
  open,
  onClose,
  confirmRunwayId = "runway.auth.logout.confirm",
  cancelRunwayId = "runway.auth.logout.cancel",
}: SignOutDialogProps) {
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);

  const handleSignOut = async () => {
    setLoggingOut(true);
    setLogoutError(null);
    try {
      await signOut();
    } catch (err) {
      // Even if signOut encounters an error, ensure client redirects to prevent
      // lingering private state.
      if (typeof window !== "undefined") {
        window.location.assign("/login");
      } else {
        setLogoutError(err instanceof Error ? err.message : "Unable to sign out.");
        setLoggingOut(false);
      }
    }
  };

  return (
    <Dialog
      open={open}
      onClose={() => {
        if (!loggingOut) onClose();
      }}
      title="Sign out"
    >
      <div className="space-y-4 pt-1">
        <p className="text-body-md text-on-surface-variant">
          Are you sure you want to sign out of your account?
        </p>
        {logoutError && (
          <p role="alert" className="text-body-sm text-error">
            {logoutError}
          </p>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            disabled={loggingOut}
            onClick={onClose}
            runway-id={cancelRunwayId}
            className="min-h-11 rounded-full border border-outline-variant px-space-md text-label-md font-medium text-on-surface hover:bg-black/5 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={loggingOut}
            onClick={() => void handleSignOut()}
            runway-id={confirmRunwayId}
            className="min-h-11 rounded-full bg-primary px-space-md text-label-md font-medium text-white hover:bg-primary/90 disabled:opacity-50"
          >
            {loggingOut ? "Signing out…" : "Sign out"}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
