/**
 * P3.1 Task 6 regression coverage for ProjectContactsWorkspace.tsx --
 * both exported pieces (`ProjectContactForm` standalone, and
 * `ProjectContactsWorkspace` wrapping it). Mounted via
 * react-test-renderer, same pattern as
 * projectListWorkspace_pricingModel.tsx's own "Mounted" section in this
 * package (find-by-id, `act()`-wrapped events, assert on props/state
 * after each interaction).
 *
 * Exercises, at minimum (per the Task 6 brief):
 *   - "add a contact" through ProjectContactsWorkspace (the form calls
 *     the real `upsertContact(projectId, input)` shape, the list
 *     reloads via `refreshContacts` afterward).
 *   - "edit an existing contact" (the form pre-fills from the row being
 *     edited, submits with that row's id, list reloads afterward).
 *   - ProjectContactForm's projectId-agnostic `onSubmit` contract (the
 *     actual mechanism the create-panel's future quick-add flow, Task
 *     4, depends on) -- proven by mounting the form standalone with a
 *     LOCAL onSubmit (no projectId involved at all) and confirming it
 *     receives a fully-formed ProjectContactInput.
 *   - the "different mailing address" toggle: address/city/state/zip
 *     are omitted (null) when the toggle is off, even if previously
 *     typed.
 *
 * Run with `npx tsx test/projectContactsWorkspace.tsx`.
 */
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import type { ReactTestInstance } from "react-test-renderer";
import { ProjectContactForm, ProjectContactsWorkspace } from "../src/components/ProjectContactsWorkspace";
import type { ProjectContactInput, ProjectContactRow } from "../src/services/projectIntakeService";

let checks = 0;
function check(name: string, condition: boolean) {
  if (!condition) throw new Error(`FAILED: ${name}`);
  checks++;
  console.log(`  ok — ${name}`);
}

function findById(root: ReactTestInstance, id: string): ReactTestInstance {
  return root.findByProps({ id });
}

// react-test-renderer's `.props.children` on a mounted instance can
// contain circular _owner/FiberNode references, so JSON.stringify(...)
// on it throws ("Converting circular structure to JSON"). `.children`
// (the RENDERED instance tree — TestInstances and plain strings, no
// fiber backrefs) is the safe way to read text content.
function textOf(instance: ReactTestInstance): string {
  return instance.children
    .map((child) => (typeof child === "string" ? child : textOf(child)))
    .join("");
}

function buttonText(instance: ReactTestInstance): string {
  return textOf(instance);
}

function findByLabelText(root: ReactTestInstance, labelText: string): ReactTestInstance {
  const labels = root.findAllByType("label");
  const match = labels.find((l) => textOf(l).includes(labelText));
  if (!match) throw new Error(`No <label> found containing text "${labelText}"`);
  const input = match.find((n) => n.type === "input" || n.type === "select");
  if (!input) throw new Error(`Label "${labelText}" has no input/select child`);
  return input;
}

const EXISTING_CONTACT: ProjectContactRow = {
  id: "contact-1",
  projectId: "project-1",
  fullName: "Jane Homeowner",
  preferredName: "Janie",
  role: "primary_homeowner",
  email: "jane@example.com",
  phone: "555-1234",
  preferredContactMethod: "email",
  address: null,
  city: null,
  state: null,
  zip: null,
  isPrimary: true,
  isDecisionMaker: true,
  isBillingContact: false,
  infoStatus: "partial",
  createdBy: "staff-1",
  createdAt: "2026-08-01T00:00:00.000Z",
};

async function main() {
  console.log("--- ProjectContactForm (standalone, projectId-agnostic onSubmit) ---");
  {
    const submittedInputs: ProjectContactInput[] = [];
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        React.createElement(ProjectContactForm, {
          initialContact: { role: "primary_homeowner", isPrimary: true },
          onSubmit: async (input: ProjectContactInput) => {
            // Deliberately does NOT touch a projectId or call a Server
            // Action at all -- this is exactly the "local capture"
            // shape the create panel's future quick-add flow needs
            // (see this file's header comment / the component's own
            // doc comment on why onSubmit isn't (projectId, contact)).
            submittedInputs.push(input);
          },
        })
      );
    });

    const fullNameInput = findByLabelText(renderer.root, "Full name*");
    act(() => {
      fullNameInput.props.onChange({ target: { value: "New Homeowner" } });
    });

    const form = renderer.root.findByType("form");
    await act(async () => {
      await form.props.onSubmit({ preventDefault() {} });
    });

    check("onSubmit was called exactly once", submittedInputs.length === 1);
    check("submitted fullName is trimmed and correct", submittedInputs[0].fullName === "New Homeowner");
    check("submitted role carries the quick-add default (primary_homeowner)", submittedInputs[0].role === "primary_homeowner");
    check("submitted isPrimary carries the quick-add default (true)", submittedInputs[0].isPrimary === true);
    check("submitted id is null (add mode, no existing row)", submittedInputs[0].id === null);

    console.log("\n--- ProjectContactForm: full name is required (rejects an empty submit) ---");
    const emptySubmits: ProjectContactInput[] = [];
    let renderer2!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer2 = TestRenderer.create(
        React.createElement(ProjectContactForm, {
          onSubmit: async (input: ProjectContactInput) => {
            emptySubmits.push(input);
          },
        })
      );
    });
    const form2 = renderer2.root.findByType("form");
    await act(async () => {
      await form2.props.onSubmit({ preventDefault() {} });
    });
    check("a blank full name is rejected (onSubmit never called)", emptySubmits.length === 0);
  }

  console.log("\n--- ProjectContactForm: 'different mailing address' toggle nulls address fields when off ---");
  {
    const submitted: ProjectContactInput[] = [];
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        React.createElement(ProjectContactForm, {
          onSubmit: async (input: ProjectContactInput) => {
            submitted.push(input);
          },
        })
      );
    });

    act(() => {
      findByLabelText(renderer.root, "Full name*").props.onChange({ target: { value: "Toggle Test" } });
    });

    // Turn the toggle on, type an address, then turn it back off before
    // submitting -- the submitted value must come back null, not the
    // stale typed value.
    const toggle = findByLabelText(renderer.root, "Mailing address is different from the project address");
    act(() => {
      toggle.props.onChange({ target: { checked: true } });
    });
    act(() => {
      findByLabelText(renderer.root, "Address").props.onChange({ target: { value: "123 Elsewhere St" } });
    });
    act(() => {
      toggle.props.onChange({ target: { checked: false } });
    });

    const form = renderer.root.findByType("form");
    await act(async () => {
      await form.props.onSubmit({ preventDefault() {} });
    });

    check("submit succeeded", submitted.length === 1);
    check("address is null when the mailing-address toggle is off, even after typing a value", submitted[0].address === null);
  }

  console.log("\n--- ProjectContactsWorkspace: add a contact (real projectId + Server-Action shape) ---");
  {
    const upsertCalls: { projectId: string; contact: ProjectContactInput }[] = [];
    let refreshCallCount = 0;
    const updatedList = [EXISTING_CONTACT];

    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        React.createElement(ProjectContactsWorkspace, {
          projectId: "project-1",
          projectName: "Hawks Ridge Residence",
          contacts: [],
          upsertContact: async (projectId: string, contact: ProjectContactInput) => {
            upsertCalls.push({ projectId, contact });
            return { id: "new-contact-id" };
          },
          refreshContacts: async (projectId: string) => {
            refreshCallCount++;
            check("refreshContacts is called with the workspace's own projectId", projectId === "project-1");
            return { contacts: updatedList };
          },
        })
      );
    });

    check('workspace starts with the "no contacts yet" empty state', renderer.root.findAllByProps({ className: "sc-contacts-empty" }).length === 1);

    const addButton = renderer.root
      .findAllByType("button")
      .find((b) => buttonText(b).includes("Add contact") && b.props.type === "button");
    check('an "Add contact" button is rendered', !!addButton);
    act(() => {
      addButton!.props.onClick();
    });

    act(() => {
      findByLabelText(renderer.root, "Full name*").props.onChange({ target: { value: "Quick Add Homeowner" } });
    });

    const form = renderer.root.findByType("form");
    await act(async () => {
      await form.props.onSubmit({ preventDefault() {} });
    });

    check("upsertContact was called exactly once", upsertCalls.length === 1);
    check("upsertContact was called with the workspace's real projectId", upsertCalls[0].projectId === "project-1");
    check("upsertContact received the typed full name", upsertCalls[0].contact.fullName === "Quick Add Homeowner");
    check("the list was reloaded via refreshContacts after a successful add", refreshCallCount === 1);
    check(
      "the reloaded list (from refreshContacts) is now rendered",
      renderer.root.findAllByProps({ className: "sc-contacts-table" }).length === 1
    );
  }

  console.log("\n--- ProjectContactsWorkspace: edit an existing contact ---");
  {
    const upsertCalls: { projectId: string; contact: ProjectContactInput }[] = [];
    let refreshCallCount = 0;

    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        React.createElement(ProjectContactsWorkspace, {
          projectId: "project-1",
          projectName: "Hawks Ridge Residence",
          contacts: [EXISTING_CONTACT],
          upsertContact: async (projectId: string, contact: ProjectContactInput) => {
            upsertCalls.push({ projectId, contact });
            return { id: EXISTING_CONTACT.id };
          },
          refreshContacts: async () => {
            refreshCallCount++;
            return { contacts: [{ ...EXISTING_CONTACT, phone: "555-9999" }] };
          },
        })
      );
    });

    check("the existing contact's name renders in the list", JSON.stringify(renderer.toJSON()).includes("Jane Homeowner"));

    const editButton = renderer.root.findAllByType("button").find((b) => buttonText(b).includes("Edit"));
    check('an "Edit" button is rendered for the existing row', !!editButton);
    act(() => {
      editButton!.props.onClick();
    });

    const fullNameInput = findByLabelText(renderer.root, "Full name*");
    check("the edit form pre-fills the existing contact's full name", fullNameInput.props.value === "Jane Homeowner");
    const emailInput = findByLabelText(renderer.root, "Email");
    check("the edit form pre-fills the existing contact's email", emailInput.props.value === "jane@example.com");

    act(() => {
      findByLabelText(renderer.root, "Phone").props.onChange({ target: { value: "555-9999" } });
    });

    const form = renderer.root.findByType("form");
    await act(async () => {
      await form.props.onSubmit({ preventDefault() {} });
    });

    check("upsertContact was called exactly once for the edit", upsertCalls.length === 1);
    check("the edit submitted the EXISTING contact's id (update, not a new insert)", upsertCalls[0].contact.id === EXISTING_CONTACT.id);
    check("the edit submitted the changed phone number", upsertCalls[0].contact.phone === "555-9999");
    check("unrelated fields (full name) survive the edit unchanged", upsertCalls[0].contact.fullName === "Jane Homeowner");
    check("the list was reloaded via refreshContacts after a successful edit", refreshCallCount === 1);
  }

  console.log(`\nprojectContactsWorkspace.tsx: all ${checks} checks passed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
