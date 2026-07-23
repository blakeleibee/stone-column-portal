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
import { readFileSync } from "node:fs";
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
  "tests/sql/package1_tests.sql",
  "tests/sql/package_p1_auth_tests.sql",
  "tests/sql/committed_forecast_hardening_tests.sql",
];

async function main() {
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
