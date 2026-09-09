"use client";

/**
 * Minimal management UI for creating a QuickBooks CSV import mapping
 * profile (`import_mapping_profiles`, schema/013). This is deliberately
 * a standalone form — it does not list existing profiles, does not
 * support editing/archiving, and is not wired into a route yet. That's
 * Task 11's job (the full import wizard); this component's scope per
 * the P4 task-7 brief is just "create a profile."
 *
 * Following the same pattern as EstimateTable.tsx: the Server Action
 * (createMappingProfile, a thin wrapper over
 * packages/02-app-shell/src/services/importMappingService.ts) is passed
 * in as a PROP rather than imported directly, so this package-level
 * component stays free of any dependency on apps/web's file layout (or,
 * transitively, on next/headers / @supabase/ssr).
 *
 * VISUAL MODERNIZATION (docs/production-build/VISUAL-MODERNIZATION-PLAN.md):
 * every field now composes the shared `ui/` primitives (FormField/
 * TextInput/Select/Button) instead of this file's own one-off
 * `sc-mapping-*` input/button styling — each label, control, and hint
 * still gets its own row (no compression into inline groups), matching
 * the plan's requirement. This is embedded directly inside
 * ImportWizard.tsx's own step Card, so it intentionally does NOT wrap
 * itself in a second Card — this pass is visual/structural only, no
 * prop, handler, or validation logic changed. The raw
 * `<style>{formStyles}</style>` JSX child (hydration-unsafe) is now
 * `dangerouslySetInnerHTML`, matching every other component in this
 * directory.
 */
import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { spacing, typography } from "../design/tokens";
import { FormField, TextInput, Select, Button, Alert } from "./ui";

type MappingProfileFormResult = { error?: string; id?: string };

export interface MappingProfileFormProps {
  orgId: string;
  createMappingProfile: (
    orgId: string,
    input: {
      name: string;
      columnMapping: Record<string, string>;
      strategy: "prefix" | "exact" | "manual_only";
      prefixLength?: number;
    }
  ) => Promise<MappingProfileFormResult>;
  /** Called after a successful create, in addition to this component's
   *  own router.refresh() — e.g. so a parent list can re-fetch. */
  onCreated?: (id: string) => void;
}

const COLUMN_FIELDS = [
  { key: "item", label: "item" },
  { key: "vendor", label: "vendor" },
  { key: "amount", label: "amount" },
  { key: "date", label: "date" },
  { key: "memo", label: "memo" },
] as const;

type ColumnFieldKey = (typeof COLUMN_FIELDS)[number]["key"];

export function MappingProfileForm({ orgId, createMappingProfile, onCreated }: MappingProfileFormProps) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [columns, setColumns] = useState<Record<ColumnFieldKey, string>>({
    item: "",
    vendor: "",
    amount: "",
    date: "",
    memo: "",
  });
  const [strategy, setStrategy] = useState<"prefix" | "exact" | "manual_only">("prefix");
  const [prefixLength, setPrefixLength] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function resetForm() {
    setName("");
    setColumns({ item: "", vendor: "", amount: "", date: "", memo: "" });
    setStrategy("prefix");
    setPrefixLength("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError("A profile name is required.");
      return;
    }

    let parsedPrefixLength: number | undefined;
    if (strategy === "prefix") {
      const trimmed = prefixLength.trim();
      if (!trimmed) {
        setError("A prefix length is required when the match strategy is 'prefix'.");
        return;
      }
      const parsed = Number(trimmed);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        setError("Prefix length must be a whole number greater than zero.");
        return;
      }
      parsedPrefixLength = parsed;
    }

    setSubmitting(true);
    try {
      const result = await createMappingProfile(orgId, {
        name,
        columnMapping: columns,
        strategy,
        prefixLength: parsedPrefixLength,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      resetForm();
      router.refresh();
      if (result.id) {
        onCreated?.(result.id);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="sc-mapping-form" onSubmit={handleSubmit}>
      <FormField label="Profile name" htmlFor="sc-mapping-name">
        <TextInput id="sc-mapping-name" type="text" value={name} onChange={(e) => setName(e.target.value)} />
      </FormField>

      {COLUMN_FIELDS.map(({ key, label }) => (
        <FormField key={key} label={`Which CSV column header contains the ${label}`} htmlFor={`sc-mapping-col-${key}`}>
          <TextInput
            id={`sc-mapping-col-${key}`}
            type="text"
            value={columns[key]}
            onChange={(e) => setColumns((prev) => ({ ...prev, [key]: e.target.value }))}
          />
        </FormField>
      ))}

      <FormField label="Cost code match strategy" htmlFor="sc-mapping-strategy">
        <Select
          id="sc-mapping-strategy"
          value={strategy}
          onChange={(e) => setStrategy(e.target.value as "prefix" | "exact" | "manual_only")}
        >
          <option value="prefix">Prefix</option>
          <option value="exact">Exact</option>
          <option value="manual_only">Manual only</option>
        </Select>
      </FormField>

      {strategy === "prefix" && (
        <FormField label="Prefix length" htmlFor="sc-mapping-prefix-length">
          <TextInput
            id="sc-mapping-prefix-length"
            type="number"
            min={1}
            step={1}
            value={prefixLength}
            onChange={(e) => setPrefixLength(e.target.value)}
          />
        </FormField>
      )}

      <Button type="submit" variant="primary" disabled={submitting} loading={submitting} loadingText="Saving…">
        Save mapping profile
      </Button>
      {error && <Alert tone="error">{error}</Alert>}
      <style dangerouslySetInnerHTML={{ __html: formStyles }} />
    </form>
  );
}

const formStyles = `
.sc-mapping-form { display: flex; flex-direction: column; gap: ${spacing.md}; font-family: ${typography.fontFamily}; max-width: 420px; }
`;
