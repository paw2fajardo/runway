"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  fullScreen?: boolean;
  className?: string;
}

export function Dialog({ open, onClose, title, children, fullScreen = false, className = "" }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const instanceId = useId();
  const backdropStart = useRef(false);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || !open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    if (!dialog.open) dialog.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      if (dialog.open) dialog.close();
      document.body.style.overflow = previousOverflow;
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [open]);

  useEffect(() => {
    if (!open || !className.split(/\s+/).includes("app-dialog-quick-log")) return;
    const dialog = ref.current;
    const viewport = window.visualViewport;
    if (!dialog || !viewport) return;
    const updateHeight = () => dialog.style.setProperty("--quick-log-viewport-height", `${viewport.height}px`);
    updateHeight();
    viewport.addEventListener("resize", updateHeight);
    return () => {
      viewport.removeEventListener("resize", updateHeight);
      dialog.style.removeProperty("--quick-log-viewport-height");
    };
  }, [open, className]);

  return (
    <dialog ref={ref} runway-id={`runway.dialog.${instanceId}`} aria-labelledby={titleId} className={`glass-panel app-dialog${fullScreen ? " app-dialog-fullscreen" : ""}${className ? ` ${className}` : ""}`}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onPointerDown={(event) => { backdropStart.current = event.target === event.currentTarget; }}
      onClick={(event) => {
        if (backdropStart.current && event.target === event.currentTarget) onClose();
        backdropStart.current = false;
      }}>
      <div runway-id={`runway.dialog.${instanceId}.content`} className={fullScreen ? "app-dialog-content app-dialog-fullscreen-content" : "app-dialog-content"}>
        <header className={`flex items-center justify-between gap-4 mb-5${fullScreen ? " app-dialog-fullscreen-header" : ""}`}>
          <h2 id={titleId} runway-id={`runway.dialog.${instanceId}.title`} className="text-headline-sm font-semibold">{title}</h2>
          <button type="button" onClick={onClose} runway-id={`runway.dialog.${instanceId}.close`} aria-label={`Close ${title}`}
            className="w-11 h-11 shrink-0 rounded-full border border-white/70 bg-white/70 text-on-surface text-xl hover:bg-white transition-colors">×</button>
        </header>
        {children}
      </div>
    </dialog>
  );
}
