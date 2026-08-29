-- =====================================================================
-- Stone Column Portal — Migration 019 ROLLBACK.
-- Reverses schema/019_project_staff_assignments_self_read.sql.
-- =====================================================================

drop policy if exists project_staff_assignments_self_select on project_staff_assignments;
