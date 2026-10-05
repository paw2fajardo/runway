"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";

const PRIMARY_PAGES = ["/", "/bills", "/accounts", "/inbox"];
const MIN_SWIPE_DISTANCE = 72;
const EDGE_GUARD = 28;

interface TouchStart {
  x: number;
  y: number;
  at: number;
}

function isInsideHorizontalScroller(target: Element, main: Element) {
  let element: Element | null = target;
  while (element && element !== main) {
    const style = window.getComputedStyle(element);
    if ((style.overflowX === "auto" || style.overflowX === "scroll") && element.scrollWidth > element.clientWidth + 2) {
      return true;
    }
    element = element.parentElement;
  }
  return false;
}

export function PrimaryPageSwipeNavigation({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    const currentPage = PRIMARY_PAGES.indexOf(pathname);
    if (currentPage < 0) return;

    let start: TouchStart | null = null;

    const handleTouchStart = (event: TouchEvent) => {
      start = null;
      if (event.touches.length !== 1 || !window.matchMedia("(max-width: 767px)").matches) return;
      if (document.querySelector("dialog[open]")) return;

      const target = event.target;
      if (!(target instanceof Element)) return;
      const main = target.closest("main");
      if (!main || target.closest("a, button, input, select, textarea, summary, [role='button'], [role='link'], [contenteditable='true'], [data-swipe-ignore]")) return;
      if (isInsideHorizontalScroller(target, main)) return;

      const touch = event.touches[0];
      if (touch.clientX <= EDGE_GUARD || touch.clientX >= window.innerWidth - EDGE_GUARD) return;
      start = { x: touch.clientX, y: touch.clientY, at: performance.now() };
    };

    const handleTouchEnd = (event: TouchEvent) => {
      if (!start || event.changedTouches.length !== 1) return;
      const initial = start;
      start = null;

      const touch = event.changedTouches[0];
      const deltaX = touch.clientX - initial.x;
      const deltaY = touch.clientY - initial.y;
      if (performance.now() - initial.at > 700 || Math.abs(deltaX) < MIN_SWIPE_DISTANCE || Math.abs(deltaX) < Math.abs(deltaY) * 1.35) return;

      const nextPage = PRIMARY_PAGES[currentPage + (deltaX < 0 ? 1 : -1)];
      if (nextPage) router.push(nextPage);
    };

    const reset = () => { start = null; };
    window.addEventListener("touchstart", handleTouchStart, { passive: true });
    window.addEventListener("touchend", handleTouchEnd, { passive: true });
    window.addEventListener("touchcancel", reset, { passive: true });
    return () => {
      window.removeEventListener("touchstart", handleTouchStart);
      window.removeEventListener("touchend", handleTouchEnd);
      window.removeEventListener("touchcancel", reset);
    };
  }, [pathname, router]);

  return children;
}
