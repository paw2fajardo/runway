import { afterEach, describe, expect, it, vi } from "vitest";

const { effects, dialogs } = vi.hoisted(() => ({
  effects: [] as Array<() => void | (() => void)>,
  dialogs: [] as Array<{ open: boolean; showModal: () => void; close: () => void }>,
}));

vi.mock("react", () => ({
  useEffect: (effect: () => void | (() => void)) => effects.push(effect),
  useId: () => "test-dialog",
  useRef: () => ({ current: dialogs[dialogs.length - 1] }),
}));

import { Dialog } from "../src/components/ui/Dialog";

afterEach(() => {
  effects.length = 0;
  dialogs.length = 0;
  vi.unstubAllGlobals();
});

function setup(overflow = "") {
  const body = { style: { overflow } };
  vi.stubGlobal("document", { body, activeElement: null });
  vi.stubGlobal("HTMLElement", class {});
  // Only exercise dialog effects; no DOM renderer is needed for the scroll lock.
  vi.stubGlobal("React", { createElement: () => null });
  return body;
}

function openDialog() {
  const dialog = {
    open: false,
    showModal() { this.open = true; },
    close() { this.open = false; },
  };
  dialogs.push(dialog);
  effects.length = 0;
  Dialog({ open: true, onClose: () => {}, title: "Test", children: null });
  return effects[0]() as () => void;
}

describe("Dialog page scroll lock", () => {
  it("restores the original overflow after a single dialog closes", () => {
    const body = setup("auto");
    const close = openDialog();
    expect(body.style.overflow).toBe("hidden");
    close();
    expect(body.style.overflow).toBe("auto");
  });

  it.each(["parent first", "child first"])("unlocks after discarding nested dialogs: %s", (order) => {
    const body = setup();
    const closeParent = openDialog();
    const closeChild = openDialog();
    const [closeFirst, closeLast] = order === "parent first"
      ? [closeParent, closeChild] : [closeChild, closeParent];
    closeFirst();
    const overflowWhileOpen = body.style.overflow;
    closeLast();
    expect(overflowWhileOpen).toBe("hidden");
    expect(body.style.overflow).toBe("");
  });

  it("keeps the page locked when dismissing discard confirmation to keep editing", () => {
    const body = setup();
    const closeParent = openDialog();
    const closeChild = openDialog();
    closeChild();
    const overflowWhileEditing = body.style.overflow;
    closeParent();
    expect(overflowWhileEditing).toBe("hidden");
    expect(body.style.overflow).toBe("");
  });
});
