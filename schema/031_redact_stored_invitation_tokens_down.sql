-- =====================================================================
-- Down migration for 031_redact_stored_invitation_tokens.
--
-- Intentionally a no-op. The forward migration destroys credential
-- material on purpose; the original tokens are not recoverable from
-- this database and MUST NOT be. "Rolling back" a redaction would mean
-- restoring live access tokens into stored message bodies, which is
-- precisely the condition the redaction exists to eliminate.
--
-- Any vendor who genuinely needs access should be issued a new
-- invitation through the ordinary staff flow.
-- =====================================================================

-- (no statements — see above)
select 1;
