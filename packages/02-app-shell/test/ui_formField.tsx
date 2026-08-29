/**
 * Regression coverage for the new shared UI primitive layer's FormField
 * (packages/02-app-shell/src/components/ui/FormField.tsx) — application-
 * wide visual modernization, primitives-only phase. Mounted via
 * react-test-renderer, same pattern as this package's other component
 * tests.
 *
 * FormField is the component that directly fixes the modernization
 * plan's "do not compress labels, controls, checkboxes, and explanations
 * into inline rows" requirement, and it must not regress the one thing
 * every existing form in this codebase already gets right: a real
 * `<label htmlFor>` associated with the control's id. Exercises: id
 * generation/reuse (generated vs. the control's own id vs. an explicit
 * override), the required-marker, hint vs. error precedence (and that
 * error flips the control's `aria-invalid`/`hasError`), and
 * `aria-describedby` wiring.
 *
 * Run with `npx tsx test/ui_formField.tsx`.
 */
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import type { ReactTestInstance } from "react-test-renderer";
import { FormField } from "../src/components/ui/FormField";
import { TextInput } from "../src/components/ui/TextInput";

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
  console.log("--- Generated id: label and control agree, with no id supplied anywhere ---");
  {
    const renderer = render(
      <FormField label="Project name">
        <TextInput />
      </FormField>
    );
    const label = renderer.root.findByType("label");
    const input = renderer.root.findByType("input");
    check("label has a real htmlFor", typeof label.props.htmlFor === "string" && label.props.htmlFor.length > 0);
    check("the control's id matches the label's htmlFor exactly", input.props.id === label.props.htmlFor);
  }

  console.log("\n--- The control's own id, when it already has one, is reused rather than overwritten ---");
  {
    const renderer = render(
      <FormField label="Project name">
        <TextInput id="sc-proj-name" />
      </FormField>
    );
    const label = renderer.root.findByType("label");
    const input = renderer.root.findByType("input");
    check("the control's pre-existing id is preserved", input.props.id === "sc-proj-name");
    check("the label's htmlFor matches that pre-existing id", label.props.htmlFor === "sc-proj-name");
  }

  console.log("\n--- An explicit htmlFor override wins over the control's own id ---");
  {
    const renderer = render(
      <FormField label="Project name" htmlFor="explicit-id">
        <TextInput id="sc-proj-name" />
      </FormField>
    );
    const label = renderer.root.findByType("label");
    const input = renderer.root.findByType("input");
    check("the explicit htmlFor is used", label.props.htmlFor === "explicit-id");
    check("the control's id is overridden to match it (so they still agree)", input.props.id === "explicit-id");
  }

  console.log("\n--- required renders a visible marker ---");
  {
    const renderer = render(
      <FormField label="Project name" required>
        <TextInput />
      </FormField>
    );
    const label = renderer.root.findByType("label");
    check("the required marker is present in the label", textOf(label).includes("*"));
  }
  {
    const renderer = render(
      <FormField label="Project name">
        <TextInput />
      </FormField>
    );
    const label = renderer.root.findByType("label");
    check("no required marker when required is omitted", !textOf(label).includes("*"));
  }

  console.log("\n--- Hint renders and is wired via aria-describedby when there is no error ---");
  {
    const renderer = render(
      <FormField label="Project location" hint="Leave blank if not established yet">
        <TextInput />
      </FormField>
    );
    const input = renderer.root.findByType("input");
    const hintParagraphs = renderer.root.findAllByProps({ className: "sc-ui-field-hint" });
    check("exactly one hint paragraph renders", hintParagraphs.length === 1);
    check("the hint text is rendered", textOf(hintParagraphs[0]).includes("Leave blank if not established yet"));
    check(
      "the control's aria-describedby references the hint's id",
      typeof input.props["aria-describedby"] === "string" && input.props["aria-describedby"] === hintParagraphs[0].props.id
    );
    check("the control has no aria-invalid when there is no error", input.props["aria-invalid"] === undefined);
    check("the control has no hasError when there is no error", input.props.hasError === undefined);
  }

  console.log("\n--- Error takes precedence over hint, and flips the control into its error state ---");
  {
    const renderer = render(
      <FormField label="Project name" hint="A hint that should be suppressed" error="Project name is required.">
        <TextInput />
      </FormField>
    );
    const input = renderer.root.findByType("input");
    const textInput = renderer.root.findByType(TextInput);
    check("the hint is suppressed while an error is present", renderer.root.findAllByProps({ className: "sc-ui-field-hint" }).length === 0);
    const errorParagraphs = renderer.root.findAllByProps({ className: "sc-ui-field-error" });
    check("exactly one error paragraph renders", errorParagraphs.length === 1);
    check("the error text is rendered", textOf(errorParagraphs[0]).includes("Project name is required."));
    check("the error paragraph has role=\"alert\"", errorParagraphs[0].props.role === "alert");
    check(
      "the control's aria-describedby references the error's id",
      input.props["aria-describedby"] === errorParagraphs[0].props.id
    );
    check("the control's aria-invalid is set to true", input.props["aria-invalid"] === true);
    // hasError is a TextInput-level prop consumed to pick a class name
    // (sc-ui-input-error), not forwarded to the underlying <input> DOM
    // node — checked on the TextInput element itself, and on the host
    // input's resulting className as the actual visible effect.
    check("FormField passes hasError=true down to the TextInput element", textInput.props.hasError === true);
    check("the host input's className reflects the error state", input.props.className.includes("sc-ui-input-error"));
  }

  console.log(`\nui_formField.tsx: all ${checks} checks passed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
