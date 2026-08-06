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
 */
import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { colors, spacing, typography, radius } from "../design/tokens";

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
      <div className="sc-mapping-field">
        <label htmlFor="sc-mapping-name">Profile name</label>
        <input
          id="sc-mapping-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="sc-mapping-input"
        />
      </div>

      {COLUMN_FIELDS.map(({ key, label }) => (
        <div className="sc-mapping-field" key={key}>
          <label htmlFor={`sc-mapping-col-${key}`}>Which CSV column header contains the {label}</label>
          <input
            id={`sc-mapping-col-${key}`}
            type="text"
            value={columns[key]}
            onChange={(e) => setColumns((prev) => ({ ...prev, [key]: e.target.value }))}
            className="sc-mapping-input"
          />
        </div>
      ))}

      <div className="sc-mapping-field">
        <label htmlFor="sc-mapping-strategy">Cost code match strategy</label>
        <select
          id="sc-mapping-strategy"
          value={strategy}
          onChange={(e) => setStrategy(e.target.value as "prefix" | "exact" | "manual_only")}
          className="sc-mapping-input"
        >
          <option value="prefix">Prefix</option>
          <option value="exact">Exact</option>
          <option value="manual_only">Manual only</option>
        </select>
      </div>

      {strategy === "prefix" && (
        <div className="sc-mapping-field">
          <label htmlFor="sc-mapping-prefix-length">Prefix length</label>
          <input
            id="sc-mapping-prefix-length"
            type="number"
            min={1}
            step={1}
            value={prefixLength}
            onChange={(e) => setPrefixLength(e.target.value)}
            className="sc-mapping-input"
          />
        </div>
      )}

      <button type="submit" className="sc-mapping-btn sc-mapping-btn-primary" disabled={submitting}>
        {submitting ? "Saving…" : "Save mapping profile"}
      </button>
      {error && <div className="sc-mapping-error">{error}</div>}
      <style>{formStyles}</style>
    </form>
  );
}

const formStyles = `
.sc-mapping-form { display: flex; flex-direction: column; gap: ${spacing.md}; font-family: ${typography.fontFamily}; max-width: 420px; }
.sc-mapping-field { display: flex; flex-direction: column; gap: 4px; }
.sc-mapping-field label { font-size: ${typography.sizeXs}; color: ${colors.stoneDark}; font-weight: 600; letter-spacing: 0.02em; text-transform: uppercase; }
.sc-mapping-input { padding: 7px 9px; border: 1px solid ${colors.line}; border-radius: ${radius.sm}; font-family: ${typography.fontFamily}; font-size: ${typography.sizeSm}; color: ${colors.ink}; background: ${colors.white}; }
.sc-mapping-btn { padding: 8px 14px; border: 1px solid ${colors.line}; border-radius: ${radius.sm}; background: ${colors.white}; color: ${colors.ink2}; font-size: ${typography.sizeSm}; cursor: pointer; align-self: flex-start; }
.sc-mapping-btn-primary { background: ${colors.sage}; color: ${colors.white}; border-color: ${colors.sage}; }
.sc-mapping-btn:disabled { opacity: 0.6; cursor: not-allowed; }
.sc-mapping-error { color: ${colors.brick}; font-size: ${typography.sizeXs}; }
`;
