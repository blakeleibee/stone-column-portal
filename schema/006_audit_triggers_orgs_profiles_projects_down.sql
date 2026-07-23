drop policy if exists audit_log_org_scoped_select on audit_log;

drop trigger if exists audit_project_fee_rules on project_fee_rules;
drop trigger if exists audit_project_members on project_members;
drop trigger if exists audit_projects on projects;
drop trigger if exists audit_profiles on profiles;
drop trigger if exists audit_orgs on orgs;

-- Not in the original brief: the up migration had to introduce two new
-- helper functions (log_audit_self_scoped, log_audit_no_project)
-- because log_audit() itself (schema/001, unmodified) cannot be
-- attached directly to a table without a project_id column -- see the
-- up migration's header comment for the full explanation. Dropping
-- them here keeps this down migration a complete reversal.
drop function if exists public.log_audit_self_scoped();
drop function if exists public.log_audit_no_project();
