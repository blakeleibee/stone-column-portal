-- =====================================================================
-- Stone Column Portal — Migration 017: reversible project status
-- lifecycle + change_project_status() RPC (P3 owner-preview round 2,
-- Task D1).
--
-- Owner-preview round 2 found two real gaps in the P3 "Archived" tab
-- (schema/016_project_staff_access_foundation.sql, ProjectListWorkspace's
-- Archived view): there was no UI path to ever GET a project into
-- status='archived' in the first place, and schema/008's transition
-- trigger made archival permanent (no transition FROM 'archived' was
-- allowed at all — a project could not be un-archived).
--
-- Per this repo's established convention (already used for
-- is_org_staff() in schema/016 — CREATE OR REPLACE in a new, later
-- migration, never editing a historical file in place), this migration
-- widens enforce_project_status_transition() (originally
-- schema/008_project_status_transitions.sql) via CREATE OR REPLACE,
-- rather than editing schema/008 itself. schema/008 is untouched.
--
-- Full valid transition set as of this migration (every schema/008
-- transition preserved unchanged, plus exactly four new ones marked
-- NEW below):
--   draft      -> active
--   active     -> on_hold
--   active     -> closed_out
--   active     -> archived      (NEW — direct archive from Active)
--   on_hold    -> active
--   on_hold    -> closed_out
--   closed_out -> archived      (unchanged, already existed)
--   closed_out -> active        (NEW — "Completed -> Active")
--   archived   -> active        (NEW — the reversibility fix,
--                                 "Archived -> Active")
--   archived   -> closed_out    (NEW — "Archived -> Completed")
-- Every other transition (e.g. draft -> archived, on_hold -> archived,
-- draft -> closed_out) remains rejected, unchanged from schema/008.
-- on_hold -> archived is deliberately NOT added — not requested by the
-- owner, and not a transition this migration's brief asked for; adding
-- it would be "completing the matrix" beyond the actual ask.
--
-- Also adds change_project_status(p_project_id, p_new_status): a
-- friendly, admin-only entry point for the UI to drive a status change
-- (checked explicitly inside the function, same is_org_admin_for_org()
-- pattern as create_project_with_defaults() in schema/016), SECURITY
-- INVOKER (also matching create_project_with_defaults()). The RPC does
-- a plain UPDATE and deliberately does NOT duplicate the
-- transition-validity logic above — the trigger (attached to
-- `projects`, untouched by this migration — only the function body it
-- calls changes) is the single source of truth for which transitions
-- are valid, and rejects an invalid one with its own exception. No new
-- audit work is required: audit_projects (schema/006_audit_triggers_
-- orgs_profiles_projects.sql, `after update on projects ... execute
-- function log_audit_self_scoped()`) already fires on every UPDATE to
-- `projects` unconditionally, including a plain status change made
-- through this RPC's own UPDATE statement — confirmed by reading
-- schema/006 directly, not assumed.
--
-- FIX ROUND 1 (independent review, empirically proven, not
-- theorized): the RPC's own admin check is NOT the real authorization
-- boundary for who may change a project's status — a project_manager/
-- accounting/general staff caller (any non-superintendent staff;
-- is_financial_staff() in schema/016) can reach `projects` directly
-- through PostgREST (`supabase.from("projects").update(...)`),
-- bypassing change_project_status() entirely. projects_staff_update's
-- RLS policy (schema/016 lines 522-525, already deployed, pre-dating
-- this migration) is `using (is_financial_staff(id))` — admits any
-- non-superintendent staff, not just admins; only projects_staff_insert
-- is admin-only (`is_org_admin_for_org(org_id)`), which is why "mirrors
-- create_project_with_defaults()'s pattern" felt safe but didn't
-- actually transfer — INSERT and UPDATE are different RLS policies, and
-- only INSERT was ever admin-gated. Before this migration this
-- didn't matter much in practice (archival was one-directional and
-- effectively permanent regardless of who set it); this migration is
-- what makes it consequential, since a non-admin could now silently
-- archive OR restore a project via a raw UPDATE. Fixed below by moving
-- the admin check into enforce_project_status_transition() itself — the
-- one piece of logic every write path (the RPC, a raw PostgREST
-- UPDATE, a future direct-SQL admin tool) all funnel through — rather
-- than relying on the RPC's own check, which only covers callers who
-- go through the RPC.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Widen enforce_project_status_transition() (schema/008) to allow the
-- four new transitions listed above, AND (FIX ROUND 1) make it the
-- actual authorization boundary for WHO may change a project's status —
-- not just WHICH transitions are shaped validly. Same signature, same
-- language/set search_path clauses as the original; the trigger itself
-- (projects_status_transition, schema/008) is not redefined here — it
-- already points at this function by name, so CREATE OR REPLACE is
-- sufficient to change its behavior.
--
-- The admin check is gated on `NEW.status is distinct from OLD.status`
-- specifically — not on every UPDATE to `projects` — so it doesn't
-- newly restrict the non-status field writes (e.g. gmp_amount_cents)
-- that projects_staff_update's RLS policy already legitimately allows
-- a non-admin financial staff caller to make. `NEW.org_id` is safe to
-- read here: org_id is never edited (no code path changes it after
-- insert), so NEW.org_id and OLD.org_id are always equal on this row.
-- is_org_admin_for_org() is the same helper change_project_status()
-- below already calls — this closes the same authorization gap at the
-- one place every write path (the RPC, a raw PostgREST UPDATE, any
-- future direct-SQL tool) actually funnels through.
-- ---------------------------------------------------------------------
create or replace function public.enforce_project_status_transition() returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if NEW.status = OLD.status then
    return NEW;
  end if;

  if not is_org_admin_for_org(NEW.org_id) then
    raise exception 'Only an org admin may change a project''s status.';
  end if;

  if not (
    (OLD.status = 'draft'      and NEW.status = 'active') or
    (OLD.status = 'active'     and NEW.status in ('on_hold', 'closed_out', 'archived')) or
    (OLD.status = 'on_hold'    and NEW.status in ('active', 'closed_out')) or
    (OLD.status = 'closed_out' and NEW.status in ('archived', 'active')) or
    (OLD.status = 'archived'   and NEW.status in ('active', 'closed_out'))
  ) then
    raise exception 'Invalid project status transition: % -> % (id=%)', OLD.status, NEW.status, OLD.id;
  end if;

  return NEW;
end;
$$;

-- ---------------------------------------------------------------------
-- change_project_status(): the sanctioned RPC entry point for the UI to
-- request a status change. Its own is_org_admin_for_org() check below
-- is a FRIENDLY pre-check, not the real authorization boundary (FIX
-- ROUND 1) — it exists purely so a non-admin caller going through this
-- RPC gets a clear "Only an org admin..." error before ever reaching
-- the UPDATE, rather than a raw trigger exception. The actual boundary,
-- enforced identically for this RPC AND any other write path (a raw
-- PostgREST UPDATE included), is the admin check now inside
-- enforce_project_status_transition() above. Looks the project's org up
-- through the caller's own RLS-scoped session (SECURITY INVOKER, so
-- this SELECT is subject to projects_staff_select same as any other
-- caller query) — a project the caller cannot see at all resolves to a
-- null org id, which is treated as "not found", not silently passed
-- through to the admin check below.
-- ---------------------------------------------------------------------
create or replace function public.change_project_status(
  p_project_id uuid,
  p_new_status project_status
) returns void
language plpgsql security invoker
set search_path = public, pg_temp
as $$
declare
  v_org_id uuid;
begin
  select org_id into v_org_id from projects where id = p_project_id;

  if v_org_id is null then
    raise exception 'Project % not found or not accessible.', p_project_id;
  end if;

  if not is_org_admin_for_org(v_org_id) then
    raise exception 'Only an org admin may change a project''s status.';
  end if;

  -- Deliberately no transition-validity check here — the
  -- projects_status_transition trigger (schema/008, whose function
  -- body this migration widens above) is the single source of truth
  -- for which OLD.status -> NEW.status pairs are legal, and raises its
  -- own clear exception for an invalid one. Duplicating that condition
  -- here would create a second copy one keystroke away from drifting
  -- from the trigger's.
  update projects set status = p_new_status where id = p_project_id;
end;
$$;

revoke all on function public.change_project_status(uuid, project_status) from public;
grant execute on function public.change_project_status(uuid, project_status) to authenticated;
