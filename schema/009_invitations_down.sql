drop function if exists public.accept_invitation(text, text);
drop trigger if exists audit_invitations on invitations;
drop table if exists invitations;
