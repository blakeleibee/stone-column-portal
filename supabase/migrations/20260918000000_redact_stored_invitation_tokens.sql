-- =====================================================================
-- Stone Column Portal — Migration 031: scrub already-stored vendor bid
-- invitation tokens out of the correspondence thread.
--
-- FINDING (independent external review of the P5.2 package). Until the
-- accompanying bidService.inviteVendor() change, the invitation email's
-- full text — including the live one-time access link
-- (`/vendor/invite/<token>`) — was persisted verbatim into
-- entity_messages.body. That token is a bearer credential valid until
-- the invitation expires (14 days by default). Persisting it meant a
-- working credential rendered in the vendor's own Messages panel and
-- survived in every export, screenshot, and backup of that thread —
-- far more exposure than the single inbox it was addressed to.
--
-- The code fix stops NEW invitations from ever storing the link
-- (correspondenceService's new `storedBody`, covered by
-- packages/02-app-shell/test/bidService_invitation_token_redaction_unit.ts).
-- This migration deals with rows already written before that fix.
--
-- WHY A MIGRATION AND NOT A SCRIPT: schema/028 does
-- `revoke update, delete on entity_messages from authenticated, anon`,
-- so no application session — service functions included — can rewrite
-- a message body. Only a migration, running as the table owner, can.
-- That restriction is deliberate (the thread is an append-only record);
-- this is the one sanctioned exception, and it removes a credential
-- rather than altering the meaning of any message.
--
-- SURGICAL BY DESIGN: only the token characters are replaced, and only
-- inside a `/vendor/invite/` URL path. Subject lines, sender, recipient,
-- timestamps, delivery status, and every other word of every message
-- body are untouched, so the thread stays a faithful record of what was
-- sent — it simply no longer hands out a usable key.
-- =====================================================================

update public.entity_messages
set body = regexp_replace(
  body,
  '(/vendor/invite/)[A-Za-z0-9._~-]{16,}',
  '\1[redacted-see-invitation-email]',
  'g'
)
where body ~ '/vendor/invite/[A-Za-z0-9._~-]{16,}';
