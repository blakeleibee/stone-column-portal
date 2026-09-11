import type { EmailService, EmailSendResult, OutboundEmailMessage } from "./EmailService";

/**
 * The fallback implementation used automatically whenever RESEND_API_KEY
 * is absent (see getEmailService.ts) — matching the owner's explicit
 * instruction that this codebase must never fake "email sent
 * successfully" behavior. Every call is logged (for local visibility —
 * this is the ONLY place an operator can currently see that a send was
 * attempted, since no email infrastructure exists to check otherwise)
 * and reported back with the honest, distinct 'pending_provider_
 * configuration' status — never 'sent', never 'delivered'. Every caller
 * of EmailService.send() (inviteVendor, sendStaffMessage) is required to
 * branch on this status and show the user an honest "not configured"
 * message rather than a false success.
 */
export class NullEmailService implements EmailService {
  async send(message: OutboundEmailMessage): Promise<EmailSendResult> {
    console.warn(
      `[NullEmailService] RESEND_API_KEY is not configured — no email was sent. Would have sent "${message.subject}" to ${message.to}.`
    );
    return { providerMessageId: null, status: "pending_provider_configuration" };
  }
}
