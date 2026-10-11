import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  pathname: "/",
  push: vi.fn(),
  effects: [] as Array<() => void | (() => void)>,
}));
vi.mock("react", () => ({
  useEffect: (effect: () => void | (() => void)) => state.effects.push(effect),
  useRef: (current: unknown) => ({ current }),
  useState: (value: unknown) => [value, vi.fn()],
}));
vi.mock("next/navigation", () => ({
  usePathname: () => state.pathname,
  useRouter: () => ({ push: state.push }),
}));
import { PrimaryPageSwipeNavigation } from "../src/components/layout/PrimaryPageSwipeNavigation";

afterEach(() => {
  state.effects.length = 0;
  state.push.mockClear();
  vi.unstubAllGlobals();
});

function setup(pathname: string, dialogOpen = false) {
  state.pathname = pathname;
  const listeners = new Map<string, (event: unknown) => void>();
  const main = {};
  class Target {
    parentElement = main;
    closest(selector: string) { return selector === "main" ? main : null; }
  }
  vi.stubGlobal("Element", Target);
  vi.stubGlobal("React", { createElement: () => null });
  vi.stubGlobal("document", { querySelector: () => dialogOpen ? {} : null });
  vi.stubGlobal("window", {
    innerWidth: 390,
    matchMedia: () => ({ matches: true }),
    getComputedStyle: () => ({ overflowX: "visible" }),
    addEventListener: (name: string, callback: (event: unknown) => void) => listeners.set(name, callback),
    removeEventListener: vi.fn(),
  });
  PrimaryPageSwipeNavigation({ children: null });
  state.effects.forEach(effect => effect());
  return (deltaX: number, deltaY = 0, cancelled = false) => {
    listeners.get("touchstart")?.({ target: new Target(), touches: [{ clientX: 195, clientY: 100 }] });
    if (cancelled) listeners.get("touchcancel")?.({});
    listeners.get("touchend")?.({ changedTouches: [{ clientX: 195 + deltaX, clientY: 100 + deltaY }] });
  };
}

describe("page swipe order", () => {
  const pages = ["/", "/bills", "/budgets", "/accounts", "/transactions"];
  it.each(pages.slice(0, -1).map((page, index) => [page, pages[index + 1]]))(
    "swiping left from %s opens %s", (page, next) => {
      setup(page)(-100);
      expect(state.push).toHaveBeenCalledWith(next);
    },
  );
  it.each(pages.slice(1).map((page, index) => [page, pages[index]]))(
    "swiping right from %s opens %s", (page, previous) => {
      setup(page)(100);
      expect(state.push).toHaveBeenCalledWith(previous);
    },
  );
  it.each([["/", 100], ["/transactions", -100]] as const)("does not wrap from %s", (page, delta) => {
    setup(page)(delta);
    expect(state.push).not.toHaveBeenCalled();
  });
  it("ignores vertical, short, cancelled swipes and open dialogs", () => {
    const swipe = setup("/budgets");
    swipe(-100, 100);
    swipe(-30);
    swipe(-100, 0, true);
    expect(state.push).not.toHaveBeenCalled();
    state.effects.length = 0;
    setup("/budgets", true)(-100);
    expect(state.push).not.toHaveBeenCalled();
  });
});
