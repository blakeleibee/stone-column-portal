#!/usr/bin/env node
// Executes the full schema migration chain plus the SQL test suites
// against a fresh in-memory PGlite instance (a real Postgres compiled
// to WASM -- no Docker/system Postgres required). This is the first
// time schema/001-005 and the SQL test suites have ever actually run
// (see docs/production-build/P1-DESIGN.md's "Environment constraint"
// section for the full story). Exits non-zero on any failure, printing
// the failing file and the raised error.
import { PGlite } from "@electric-sql/pglite";
import { uuid_ossp } from "@electric-sql/pglite/contrib/uuid_ossp";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "../..");

const FILES = [
  "tests/sql/000_bare_postgres_bootstrap.sql",
  "schema/001_core_financial.sql",
  "schema/002_committed_forecast_hardening.sql",
  "schema/003_status_transitions_and_supersede_rpcs.sql",
  "schema/004_committed_cost_insert_guard_and_forecast_lineage_lock.sql",
  "schema/005_forecast_commit_time_lineage_consistency.sql",
  "schema/006_audit_triggers_orgs_profiles_projects.sql",
  "schema/007_vendor_identity.sql",
  "schema/008_project_status_transitions.sql",
  "schema/009_invitations.sql",
  "schema/010_documents.sql",
  "schema/011_sum_posted_expenses_rpc.sql",
  "schema/012_financial_master_data.sql",
  "schema/013_estimating_and_qb_import.sql",
  "schema/014_import_amount_canonicalization_and_audit_attribution.sql",
  "schema/015_commitments_bids_procurement.sql",
  "schema/016_project_staff_access_foundation.sql",
  "schema/017_project_status_reversible_lifecycle.sql",
  "schema/018_project_intake_and_handoff.sql",
  "schema/019_project_staff_assignments_self_read.sql",
  "schema/020_vendor_directory.sql",
  "schema/021_vendor_directory_fixes.sql",
  "schema/022_vendor_bid_access_phase_a.sql",
  "schema/023_vendor_bid_invitation_email_verification_fix.sql",
  "schema/024_bid_package_assembly_fields.sql",
  "schema/025_bid_package_documents.sql",
  "schema/026_vendor_bid_submission_revisions_qa_addenda.sql",
  "schema/027_bid_submission_revision_desync_fix.sql",
  "schema/028_bid_correspondence_and_inbound_email.sql",
  "schema/029_vendor_bid_invitation_replay_reactivation_fix.sql",
  "schema/030_revocation_invalidates_outstanding_invitations.sql",
  "schema/031_redact_stored_invitation_tokens.sql",
  "tests/sql/package1_tests.sql",
  "tests/sql/package_p1_auth_tests.sql",
  "tests/sql/package_p2_1_financial_master_data_tests.sql",
  "tests/sql/package_p4_estimating_qb_import_tests.sql",
  "tests/sql/package_p5_commitments_bids_procurement_tests.sql",
  "tests/sql/committed_forecast_hardening_tests.sql",
  "tests/sql/package_p3_project_staff_access_tests.sql",
  "tests/sql/package_p3_project_status_reversible_lifecycle_tests.sql",
  "tests/sql/package_p3_1_project_intake_and_handoff_tests.sql",
  "tests/sql/package_p5_1_vendor_directory_tests.sql",
  "tests/sql/package_p5_1_vendor_directory_fixes_tests.sql",
  "tests/sql/package_p5_2_vendor_bid_access_phase_a_tests.sql",
  "tests/sql/package_p5_2_phase_b_tests.sql",
  "tests/sql/package_p5_2_phase_c_tests.sql",
  "tests/sql/package_p5_2_phase_c_desync_fix_tests.sql",
  "tests/sql/package_p5_2_phase_d_correspondence_tests.sql",
  "tests/sql/package_p5_2_final_review_replay_reactivation_fix_tests.sql",
  "tests/sql/package_p5_2_revocation_invalidates_invitations_tests.sql",
];

// `schema/0NN_*.sql` is the single source of truth; `supabase/migrations/
// <timestamp>_*.sql` is a committed, regeneratable mirror in the CLI's
// required naming (see docs/production-build/ENVIRONMENTS-RUNBOOK.md's
// "Standing rule" section). `supabase db push` reads only the mirror, so a
// mirror that drifts from its schema/ source ships a stale (or even
// reverted) bug to every environment applied through it while the repo's
// own SQL-test suite -- which runs schema/ directly -- stays green and
// hides the drift. This has happened before in this repo's history (see
// docs/milestones/P4-complete.md, Task 2's found-during-review stale
// mirror). Fail loudly, before running anything, if any schema/ file with
// a corresponding mirror has drifted from it.
function checkMigrationMirrorsByteIdentical() {
  const schemaDir = path.join(ROOT, "schema");
  const migrationsDir = path.join(ROOT, "supabase/migrations");

  const schemaFiles = readdirSync(schemaDir).filter(
    (f) => f.endsWith(".sql") && !f.endsWith("_down.sql"),
  );
  const migrationFiles = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql"));

  process.stdout.write("Checking schema/ <-> supabase/migrations/ mirror byte-equality ... ");

  let checked = 0;
  for (const schemaFile of schemaFiles) {
    const schemaMatch = schemaFile.match(/^\d+_(.+)\.sql$/);
    if (!schemaMatch) continue;
    const name = schemaMatch[1];

    const migrationFile = migrationFiles.find((f) => {
      const migrationMatch = f.match(/^\d+_(.+)\.sql$/);
      return migrationMatch && migrationMatch[1] === name;
    });
    // Not every schema/ file is required to have a mirror yet (e.g. one
    // just added and not yet regenerated as part of a separate,
    // in-flight change) -- this guard only checks pairs that exist.
    if (!migrationFile) continue;

    const schemaPath = path.join(schemaDir, schemaFile);
    const migrationPath = path.join(migrationsDir, migrationFile);
    const schemaContent = readFileSync(schemaPath, "utf8");
    const migrationContent = readFileSync(migrationPath, "utf8");
    checked++;

    if (schemaContent !== migrationContent) {
      console.log("FAILED");
      console.error(
        `\nschema/${schemaFile} and supabase/migrations/${migrationFile} have diverged.\n` +
          `supabase/migrations/ must remain a byte-identical mirror of schema/ (see\n` +
          `docs/production-build/ENVIRONMENTS-RUNBOOK.md's "Standing rule" section).\n` +
          `Regenerate the mirror with:\n` +
          `  cp schema/${schemaFile} supabase/migrations/${migrationFile}\n`,
      );
      process.exit(1);
    }
  }

  console.log(`ok (${checked} mirrored pair(s) checked)`);
}

async function main() {
  checkMigrationMirrorsByteIdentical();

  const db = new PGlite({ extensions: { uuid_ossp, pgcrypto } });

  // Migration-runner setting, not a schema edit: is_org_staff() in
  // 001 is a LANGUAGE SQL function that forward-references the
  // not-yet-created `projects` table. Postgres validates a plain SQL
  // function body against the catalog at CREATE FUNCTION time unless
  // this is off (plpgsql defers this validation to first call either
  // way -- this only affects LANGUAGE SQL functions).
  await db.exec("set check_function_bodies = off;");

  for (const relPath of FILES) {
    const fullPath = path.join(ROOT, relPath);
    const sql = readFileSync(fullPath, "utf8");
    process.stdout.write(`Running ${relPath} ... `);
    try {
      await db.exec(sql);
      console.log("ok");
    } catch (err) {
      console.log("FAILED");
      console.error(`\n${relPath}:\n${err.message}\n`);
      process.exit(1);
    }
  }

  console.log(`\nAll ${FILES.length} SQL files applied/passed against PGlite.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
