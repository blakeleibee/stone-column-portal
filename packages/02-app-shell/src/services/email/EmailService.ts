/**
 * P5.2 Phase D — the email-sending abstraction, matching the exact
 * shape/reason this codebase already established for storage
 * (apps/web/src/server/storage/StorageAdapter.ts): a thin, provider-
 * agnostic interface so nothing else in the app ever calls a provider's
 * SDK/HTTP API directly — a future provider swap (or the hybrid
 * inbound-provider pattern P5-EXTENSION-PACKAGES-DESIGN.md's Section 5
 * flags as an acceptable outcome) touches exactly one implementation,
 * never every call site.
 *
 * `send()` NEVER throws for an ordinary "couldn't deliver" outcome —
 * every real failure mode (no provider configured, the provider
 * rejected the request, a network error) is a normal, typed
 * `EmailSendResult`, because the caller (bidService.ts's inviteVendor,
 * correspondenceService.ts's sendStaffMessage) always needs to persist
 * an honest entity_messages row describing what actually happened,
 * never an unhandled rejection that would leave a "did this even
 * attempt to send" gap in the record.
 */
export interface OutboundEmailMessage {
  to: string;
  from: string;
  subject: string;
  text: string;
  html?: string;
  /** Sets the Reply-To header — this is how P5.2 Phase D's per-thread
   *  inbound_reply_tokens address (`reply+<token>@notify.stonecolumn.com`)
   *  gets embedded on every outbound notification for a thread. */
  replyTo?: string;
}

/** 'sent' means the configured provider accepted the request for
 *  delivery — NOT that it was actually delivered to the recipient's
 *  inbox (that is a LATER, provider-webhook-reported status this phase
 *  does not track — see schema/028's own header comment on why
 *  entity_messages has no update path yet). 'pending_provider_
 *  configuration' is the NullEmailService's own honest answer when no
 *  real provider is configured at all — this status must never be
 *  displayed or recorded as a success anywhere in this codebase. */
export type EmailSendStatus = "sent" | "pending_provider_configuration" | "failed";

export interface EmailSendResult {
  providerMessageId: string | null;
  status: EmailSendStatus;
  error?: string;
}

export interface EmailService {
  send(message: OutboundEmailMessage): Promise<EmailSendResult>;
}
