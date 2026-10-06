"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";

const PRIMARY_PAGES = ["/", "/bills", "/accounts", "/inbox"];
const MIN_SWIPE_DISTANCE = 72;
const EDGE_GUARD = 28;

interface TouchStart {
  x: number;
  y: number;
  at: number;
}

type SwipeDirection = "forward" | "backward";
type PageTransition = { direction: SwipeDirection; phase: "exit" | "enter" } | null;

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
  const [pageTransition, setPageTransition] = useState<PageTransition>(null);
  const pendingNavigation = useRef<{ destination: string; direction: SwipeDirection } | null>(null);
  const navigationTimer = useRef<number | null>(null);

  useEffect(() => {
    const pending = pendingNavigation.current;
    if (pending?.destination === pathname) {
      pendingNavigation.current = null;
      setPageTransition({ direction: pending.direction, phase: "enter" });
    }
  }, [pathname]);

  useEffect(() => () => {
    if (navigationTimer.current !== null) window.clearTimeout(navigationTimer.current);
  }, []);

  useEffect(() => {
    const currentPage = PRIMARY_PAGES.indexOf(pathname);
    if (currentPage < 0) return;

    let start: TouchStart | null = null;

    const handleTouchStart = (event: TouchEvent) => {
      start = null;
      if (pendingNavigation.current) return;
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
      if (!nextPage) return;

      const direction: SwipeDirection = deltaX < 0 ? "forward" : "backward";
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        router.push(nextPage);
        return;
      }

      pendingNavigation.current = { destination: nextPage, direction };
      setPageTransition({ direction, phase: "exit" });
      navigationTimer.current = window.setTimeout(() => {
        router.push(nextPage);
        navigationTimer.current = null;
      }, 110);
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

  return (
    <div
      key={pathname}
      className={pageTransition ? "primary-page-transition" : undefined}
      data-transition-direction={pageTransition?.direction}
      data-transition-phase={pageTransition?.phase}
      onAnimationEnd={(event) => {
        if (event.target === event.currentTarget && event.currentTarget.dataset.transitionPhase === "enter") {
          setPageTransition(null);
        }
      }}
    >
      {children}
    </div>
  );
}
