import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const signOutMock = vi.fn().mockResolvedValue(undefined);
vi.mock("../../src/lib/auth/client", () => ({
  signOut: () => signOutMock(),
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

import { SignOutDialog } from "../../src/components/auth/SignOutDialog";

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

describe("SignOutDialog component", () => {
  const assignMock = vi.fn();
  const onCloseMock = vi.fn();

  beforeEach(() => {
    signOutMock.mockClear();
    assignMock.mockClear();
    onCloseMock.mockClear();
    state.stateValues.clear();
    state.setters.clear();
    state.callIndex = 0;

    vi.stubGlobal("window", {
      location: {
        assign: assignMock,
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders dialog elements with given runway-ids and calls onClose when Cancel is clicked", () => {
    const element = SignOutDialog({
      open: true,
      onClose: onCloseMock,
      confirmRunwayId: "custom.confirm",
      cancelRunwayId: "custom.cancel",
    });

    const cancelBtn = findNode(element, (n) => n?.props?.["runway-id"] === "custom.cancel");
    expect(cancelBtn).toBeDefined();
    cancelBtn.props.onClick();
    expect(onCloseMock).toHaveBeenCalledTimes(1);

    const confirmBtn = findNode(element, (n) => n?.props?.["runway-id"] === "custom.confirm");
    expect(confirmBtn).toBeDefined();
    expect(confirmBtn.props.children).toBe("Sign out");
  });

  it("calls signOut when confirm button is clicked", async () => {
    const element = SignOutDialog({
      open: true,
      onClose: onCloseMock,
      confirmRunwayId: "custom.confirm",
      cancelRunwayId: "custom.cancel",
    });

    const confirmBtn = findNode(element, (n) => n?.props?.["runway-id"] === "custom.confirm");
    await confirmBtn.props.onClick();
    expect(signOutMock).toHaveBeenCalledTimes(1);
  });

  it("redirects to /login even if signOut throws an unhandled error", async () => {
    signOutMock.mockRejectedValueOnce(new Error("Network failed"));

    const element = SignOutDialog({
      open: true,
      onClose: onCloseMock,
    });

    const confirmBtn = findNode(element, (n) => n?.props?.["runway-id"] === "runway.auth.logout.confirm");
    await confirmBtn.props.onClick();
    expect(assignMock).toHaveBeenCalledWith("/login");
  });
});
