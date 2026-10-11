"use client";

import { useEffect, useId, useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";

// Nested dialogs can clean up in either order; restore scrolling only after the last one closes.
let openDialogCount = 0;
let previousBodyOverflow = "";

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
  const dragStart = useRef<{ pointerId: number; x: number; y: number } | null>(null);

  const handleDragStart = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "touch" || (event.target instanceof Element && event.target.closest("button, a, input, select, textarea"))) return;
    dragStart.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleDragMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = dragStart.current;
    const dialog = ref.current;
    if (!start || start.pointerId !== event.pointerId || !dialog) return;

    const deltaY = event.clientY - start.y;
    const deltaX = event.clientX - start.x;
    if (deltaY > 0 && Math.abs(deltaY) > Math.abs(deltaX)) {
      dialog.classList.add("app-dialog-dragging");
      dialog.style.transform = `translate3d(0, ${deltaY}px, 0)`;
    }
  };

  const finishDrag = (event: ReactPointerEvent<HTMLDivElement>, cancelled = false) => {
    const start = dragStart.current;
    const dialog = ref.current;
    if (!start || start.pointerId !== event.pointerId || !dialog) return;
    const deltaY = event.clientY - start.y;
    const deltaX = event.clientX - start.x;
    dragStart.current = null;
    dialog.classList.remove("app-dialog-dragging");
    dialog.style.transform = "";
    if (!cancelled && deltaY >= 96 && deltaY > Math.abs(deltaX)) onClose();
  };

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || !open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog.open) dialog.showModal();
    if (openDialogCount === 0) previousBodyOverflow = document.body.style.overflow;
    openDialogCount += 1;
    document.body.style.overflow = "hidden";
    return () => {
      if (dialog.open) dialog.close();
      openDialogCount -= 1;
      if (openDialogCount === 0) document.body.style.overflow = previousBodyOverflow;
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
        <div
          className={`app-dialog-header-region${fullScreen ? " app-dialog-fullscreen-header" : ""}`}
          onPointerDown={handleDragStart}
          onPointerMove={handleDragMove}
          onPointerUp={(event) => finishDrag(event)}
          onPointerCancel={(event) => finishDrag(event, true)}
        >
          <div className="app-dialog-drag-handle" aria-hidden="true" />
          <header className="mb-5 flex items-center justify-between gap-4">
            <h2 id={titleId} runway-id={`runway.dialog.${instanceId}.title`} className="text-headline-sm font-semibold">{title}</h2>
            <button type="button" onClick={onClose} runway-id={`runway.dialog.${instanceId}.close`} aria-label={`Close ${title}`}
              className="w-11 h-11 shrink-0 rounded-full border border-white/70 bg-white/70 text-on-surface text-xl hover:bg-white transition-colors">×</button>
          </header>
        </div>
        {children}
      </div>
    </dialog>
  );
}
