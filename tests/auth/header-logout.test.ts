import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));

vi.mock("../../src/lib/offline-db", () => ({
  getPendingQueueCount: vi.fn().mockResolvedValue(0),
  flushOfflineQueue: vi.fn().mockResolvedValue(undefined),
}));

const state = vi.hoisted(() => ({
  stateValues: new Map<number, any>(),
  setters: new Map<number, (val: any) => void>(),
  callIndex: 0,
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    useEffect: vi.fn(),
    useState: (initial: any) => {
      const idx = state.callIndex++;
      if (!state.stateValues.has(idx)) {
        state.stateValues.set(idx, initial);
      }
      const val = state.stateValues.get(idx);
      const setter = (next: any) => {
        state.stateValues.set(idx, typeof next === "function" ? next(val) : next);
      };
      state.setters.set(idx, setter);
      return [val, setter];
    },
  };
});

import { Header } from "../../src/components/layout/Header";

function findNode(tree: any, predicate: (node: any) => boolean): any {
  if (!tree) return null;
  if (predicate(tree)) return tree;
  if (Array.isArray(tree)) {
    for (const item of tree) {
      const found = findNode(item, predicate);
      if (found) return found;
    }
  } else if (typeof tree === "object" && tree.props) {
    if (tree.props.children) {
      return findNode(tree.props.children, predicate);
    }
  }
  return null;
}

describe("Header logout feature", () => {
  beforeEach(() => {
    state.stateValues.clear();
    state.setters.clear();
    state.callIndex = 0;
    vi.stubGlobal("window", {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      navigator: { onLine: true },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the sign out button with appropriate runway-id and aria-label", () => {
    const element = Header({});
    expect(element).toBeDefined();

    const logoutBtn = findNode(element, (n) => n?.props?.["runway-id"] === "runway.header.logout");
    expect(logoutBtn).toBeDefined();
    expect(logoutBtn.props["aria-label"]).toBe("Sign out");

    // Click handler opens dialog
    logoutBtn.props.onClick();
    expect(state.stateValues.get(2)).toBe(true);
  });

  it("renders the SignOutDialog when showLogoutDialog is true", () => {
    state.stateValues.set(2, true);
    state.callIndex = 0;

    const element = Header({});
    const dialogNode = findNode(element, (n) => n?.props?.confirmRunwayId === "runway.header.logout.confirm");
    expect(dialogNode).toBeDefined();
    expect(dialogNode.props.open).toBe(true);
    expect(dialogNode.props.cancelRunwayId).toBe("runway.header.logout.cancel");
  });
});
