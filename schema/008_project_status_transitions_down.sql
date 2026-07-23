drop trigger if exists projects_status_transition on projects;
drop function if exists public.enforce_project_status_transition();
