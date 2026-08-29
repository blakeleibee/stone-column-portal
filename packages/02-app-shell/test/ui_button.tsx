/**
 * Regression coverage for the new shared UI primitive layer's Button
 * (packages/02-app-shell/src/components/ui/Button.tsx) — application-wide
 * visual modernization, primitives-only phase. Mounted via
 * react-test-renderer, same pattern as this package's other component
 * tests (find-by-props, `act()`-wrapped events, assert on rendered
 * props/text).
 *
 * Exercises: variant/size class names, the disabled state, the loading
 * state (aria-busy, disabled, spinner, optional label swap per the
 * `createSubmitting`/"Saving…" pattern already used throughout this
 * package's existing screens), the default `type="button"` (never an
 * accidental implicit form submit), and that onClick still fires through
 * normally.
 *
 * Run with `npx tsx test/ui_button.tsx`.
 */
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import type { ReactTestInstance } from "react-test-renderer";
import { Button } from "../src/components/ui/Button";

let checks = 0;
function check(name: string, condition: boolean) {
  if (!condition) throw new Error(`FAILED: ${name}`);
  checks++;
  console.log(`  ok — ${name}`);
}

function textOf(instance: ReactTestInstance): string {
  return instance.children.map((child) => (typeof child === "string" ? child : textOf(child))).join("");
}

function render(node: React.ReactElement) {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(node);
  });
  return renderer;
}

async function main() {
  console.log("--- Variant/size class names ---");
  {
    const renderer = render(<Button>Save</Button>);
    const button = renderer.root.findByType("button");
    check("defaults to variant=primary", button.props.className.includes("sc-ui-btn-primary"));
    check("defaults to type=\"button\" (never an accidental implicit submit)", button.props.type === "button");
    check("renders its children as the label", textOf(button).includes("Save"));
  }
  {
    const renderer = render(<Button variant="secondary">Cancel</Button>);
    const button = renderer.root.findByType("button");
    check("variant=\"secondary\" applies sc-ui-btn-secondary", button.props.className.includes("sc-ui-btn-secondary"));
  }
  {
    const renderer = render(<Button variant="destructive">Archive</Button>);
    const button = renderer.root.findByType("button");
    check("variant=\"destructive\" applies sc-ui-btn-destructive", button.props.className.includes("sc-ui-btn-destructive"));
  }
  {
    const renderer = render(<Button size="sm">Edit</Button>);
    const button = renderer.root.findByType("button");
    check("size=\"sm\" applies sc-ui-btn-sm", button.props.className.includes("sc-ui-btn-sm"));
  }
  {
    const renderer = render(<Button type="submit">Create</Button>);
    const button = renderer.root.findByType("button");
    check("an explicit type prop is respected (not overridden to \"button\")", button.props.type === "submit");
  }

  console.log("\n--- Plain disabled state (not loading) ---");
  {
    const renderer = render(<Button disabled>Save</Button>);
    const button = renderer.root.findByType("button");
    check("disabled prop is passed through", button.props.disabled === true);
    check("aria-busy is not set when merely disabled, not loading", button.props["aria-busy"] === undefined);
    check("no spinner renders when merely disabled", renderer.root.findAllByProps({ className: "sc-ui-spinner" }).length === 0);
  }

  console.log("\n--- Loading state ---");
  {
    const renderer = render(<Button loading>Save</Button>);
    const button = renderer.root.findByType("button");
    check("loading forces disabled=true even without an explicit disabled prop", button.props.disabled === true);
    check("loading sets aria-busy=true", button.props["aria-busy"] === true);
    check("loading renders a spinner", renderer.root.findAllByProps({ className: "sc-ui-spinner" }).length === 1);
    check("without loadingText, the original children stay visible", textOf(button).includes("Save"));
  }
  {
    const renderer = render(
      <Button loading loadingText="Saving…">
        Save
      </Button>
    );
    const button = renderer.root.findByType("button");
    check("loadingText replaces the visible label while loading", textOf(button).includes("Saving…") && !textOf(button).includes("Save"));
  }
  {
    // Regression: an explicit disabled=false must not defeat the
    // loading-implies-disabled contract (the two states must merge, not
    // override each other in the wrong direction).
    const renderer = render(
      <Button loading disabled={false}>
        Save
      </Button>
    );
    const button = renderer.root.findByType("button");
    check("loading still disables the button even when disabled={false} is explicitly passed", button.props.disabled === true);
  }

  console.log("\n--- onClick still fires through normally ---");
  {
    let clicked = false;
    const renderer = render(<Button onClick={() => (clicked = true)}>Go</Button>);
    const button = renderer.root.findByType("button");
    await act(async () => {
      button.props.onClick();
    });
    check("onClick fires for a normal, non-disabled, non-loading button", clicked);
  }

  console.log(`\nui_button.tsx: all ${checks} checks passed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
