/**
 * Regression coverage for the new shared UI primitive layer's MenuButton
 * (packages/02-app-shell/src/components/ui/MenuButton.tsx) — application-
 * wide visual modernization, primitives-only phase. Mounted via
 * react-test-renderer, same pattern as this package's other component
 * tests.
 *
 * The modernization plan requires this component specifically to be
 * "keyboard-accessible (Escape closes it, arrow keys or at minimum Tab
 * navigates the items, closes on outside click) — do not ship a
 * mouse-only dropdown." This file exercises exactly that keyboard
 * contract, plus the plain open/click behavior.
 *
 * react-test-renderer's host-component refs are `null` by default (no
 * real DOM in this Node-only harness — see
 * test/estimateTable_field_sync.tsx's header comment on why this package
 * deliberately runs its component tests without jsdom); a
 * `createNodeMock` is supplied so `itemRefs`/`triggerRef`'s `.focus()`
 * calls land on trackable fakes instead of silently no-op'ing on `null`,
 * which is what actually lets this file prove focus moved to the right
 * place instead of just asserting the DOM would show a menu.
 *
 * Run with `npx tsx test/ui_menuButton.tsx`.
 */
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import type { ReactTestInstance } from "react-test-renderer";
import { MenuButton, type MenuButtonItem } from "../src/components/ui/MenuButton";

let checks = 0;
function check(name: string, condition: boolean) {
  if (!condition) throw new Error(`FAILED: ${name}`);
  checks++;
  console.log(`  ok — ${name}`);
}

function textOf(instance: ReactTestInstance): string {
  return instance.children.map((child) => (typeof child === "string" ? child : textOf(child))).join("");
}

/** Tags every rendered host node with a fake instance exposing a
 *  `.focus()` spy, keyed by its own rendered text (unique across this
 *  file's fixtures) so assertions can name exactly which node was
 *  focused. */
function createFocusTrackingMock() {
  const focusLog: string[] = [];
  function createNodeMock(element: React.ReactElement<{ children?: React.ReactNode; className?: string }>) {
    // The trigger and every menu item are all plain <button>s with
    // string children, so className (not children) is what actually
    // distinguishes the trigger ("sc-ui-menu-trigger") from an item
    // ("sc-ui-menu-item") — the trigger's own label ("Actions" in every
    // fixture below) would otherwise collide with nothing, but relying
    // on that coincidence would be fragile; className is the real,
    // structural distinguisher.
    const isTrigger = typeof element.props.className === "string" && element.props.className.includes("sc-ui-menu-trigger");
    const key = isTrigger ? "trigger" : typeof element.props.children === "string" ? element.props.children : "unknown";
    return {
      focus: () => {
        focusLog.push(key);
      },
    };
  }
  return { createNodeMock, focusLog };
}

function render(items: MenuButtonItem[], label: React.ReactNode = "Actions") {
  const { createNodeMock, focusLog } = createFocusTrackingMock();
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(<MenuButton label={label} items={items} />, { createNodeMock });
  });
  return { renderer, focusLog };
}

function trigger(renderer: TestRenderer.ReactTestRenderer): ReactTestInstance {
  return renderer.root.findByProps({ className: "sc-ui-menu-trigger" });
}

function menuItems(renderer: TestRenderer.ReactTestRenderer): ReactTestInstance[] {
  return renderer.root.findAllByProps({ role: "menuitem" });
}

async function main() {
  console.log("--- Closed by default; opens on trigger click, focusing the first item ---");
  {
    const clicks: string[] = [];
    const items: MenuButtonItem[] = [
      { key: "a", label: "Archive", onClick: () => clicks.push("a") },
      { key: "b", label: "Restore", onClick: () => clicks.push("b") },
      { key: "c", label: "Delete", onClick: () => clicks.push("c") },
    ];
    const { renderer, focusLog } = render(items);
    check("closed by default (aria-expanded=false)", trigger(renderer).props["aria-expanded"] === false);
    check("no menuitems rendered while closed", menuItems(renderer).length === 0);

    await act(async () => {
      trigger(renderer).props.onClick();
    });
    check("aria-expanded=true after clicking the trigger", trigger(renderer).props["aria-expanded"] === true);
    const items2 = menuItems(renderer);
    check("all 3 items render, in order, once open", items2.length === 3 && textOf(items2[0]).includes("Archive"));
    check("opening the menu focuses the first item", focusLog[focusLog.length - 1] === "Archive");
  }

  console.log("\n--- Escape closes the menu and returns focus to the trigger ---");
  {
    const items: MenuButtonItem[] = [
      { key: "a", label: "Archive", onClick: () => {} },
      { key: "b", label: "Restore", onClick: () => {} },
    ];
    const { renderer, focusLog } = render(items);
    await act(async () => {
      trigger(renderer).props.onClick();
    });
    const firstItem = menuItems(renderer)[0];
    await act(async () => {
      firstItem.props.onKeyDown({ key: "Escape", preventDefault: () => {} });
    });
    check("Escape closes the menu (aria-expanded=false)", trigger(renderer).props["aria-expanded"] === false);
    check("no menuitems rendered once closed again", menuItems(renderer).length === 0);
    check("focus returns to the trigger after Escape", focusLog[focusLog.length - 1] === "trigger");
  }

  console.log("\n--- ArrowDown moves focus to the next item, wrapping from the last item to the first ---");
  {
    const items: MenuButtonItem[] = [
      { key: "a", label: "Archive", onClick: () => {} },
      { key: "b", label: "Restore", onClick: () => {} },
      { key: "c", label: "Delete", onClick: () => {} },
    ];
    const { renderer, focusLog } = render(items);
    await act(async () => {
      trigger(renderer).props.onClick();
    });
    const list = menuItems(renderer);
    await act(async () => {
      list[0].props.onKeyDown({ key: "ArrowDown", preventDefault: () => {} });
    });
    check("ArrowDown on the first item focuses the second", focusLog[focusLog.length - 1] === "Restore");
    await act(async () => {
      list[1].props.onKeyDown({ key: "ArrowDown", preventDefault: () => {} });
    });
    check("ArrowDown on the second item focuses the third", focusLog[focusLog.length - 1] === "Delete");
    await act(async () => {
      list[2].props.onKeyDown({ key: "ArrowDown", preventDefault: () => {} });
    });
    check("ArrowDown on the last item wraps around to the first", focusLog[focusLog.length - 1] === "Archive");
  }

  console.log("\n--- ArrowUp moves focus to the previous item, wrapping from the first item to the last ---");
  {
    const items: MenuButtonItem[] = [
      { key: "a", label: "Archive", onClick: () => {} },
      { key: "b", label: "Restore", onClick: () => {} },
      { key: "c", label: "Delete", onClick: () => {} },
    ];
    const { renderer, focusLog } = render(items);
    await act(async () => {
      trigger(renderer).props.onClick();
    });
    const list = menuItems(renderer);
    await act(async () => {
      list[0].props.onKeyDown({ key: "ArrowUp", preventDefault: () => {} });
    });
    check("ArrowUp on the first item wraps around to the last", focusLog[focusLog.length - 1] === "Delete");
  }

  console.log("\n--- Tab closes the menu (real tab order takes over from there) ---");
  {
    const items: MenuButtonItem[] = [
      { key: "a", label: "Archive", onClick: () => {} },
      { key: "b", label: "Restore", onClick: () => {} },
    ];
    const { renderer } = render(items);
    await act(async () => {
      trigger(renderer).props.onClick();
    });
    const list = menuItems(renderer);
    await act(async () => {
      list[0].props.onKeyDown({ key: "Tab", preventDefault: () => {} });
    });
    check("Tab on a menu item closes the menu", trigger(renderer).props["aria-expanded"] === false);
  }

  console.log("\n--- Selecting an item calls its onClick, closes the menu, and returns focus to the trigger ---");
  {
    const clicks: string[] = [];
    const items: MenuButtonItem[] = [
      { key: "a", label: "Archive", onClick: () => clicks.push("archive") },
      { key: "b", label: "Restore", onClick: () => clicks.push("restore") },
    ];
    const { renderer, focusLog } = render(items);
    await act(async () => {
      trigger(renderer).props.onClick();
    });
    const restoreItem = menuItems(renderer).find((i) => textOf(i).includes("Restore"));
    if (!restoreItem) throw new Error("Restore item not found");
    await act(async () => {
      restoreItem.props.onClick();
    });
    check("clicking an item calls its own onClick exactly once", clicks.length === 1 && clicks[0] === "restore");
    check("selecting an item closes the menu", trigger(renderer).props["aria-expanded"] === false);
    check("selecting an item returns focus to the trigger", focusLog[focusLog.length - 1] === "trigger");
  }

  console.log("\n--- Disabled items render as disabled ---");
  {
    const items: MenuButtonItem[] = [
      { key: "a", label: "Archive", onClick: () => {}, disabled: true },
      { key: "b", label: "Restore", onClick: () => {} },
    ];
    const { renderer } = render(items);
    await act(async () => {
      trigger(renderer).props.onClick();
    });
    const list = menuItems(renderer);
    check("the disabled item renders with disabled=true", list[0].props.disabled === true);
    check("the other item stays enabled", list[1].props.disabled !== true);
  }

  console.log(`\nui_menuButton.tsx: all ${checks} checks passed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
