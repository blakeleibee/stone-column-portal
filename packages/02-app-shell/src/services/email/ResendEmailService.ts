import type { EmailService, EmailSendResult, OutboundEmailMessage } from "./EmailService";

/**
 * Real Resend delivery — only ever instantiated by getEmailService.ts
 * when RESEND_API_KEY is actually present. Uses Resend's plain HTTP API
 * directly (fetch), not their SDK — this is the one place in the app
 * that ever knows anything about Resend's request/response shape;
 * everything else calls the provider-agnostic EmailService interface.
 *
 * CLAUDE.md/this package's owner-approved sending domain
 * (notify.stonecolumn.com) is set by the CALLER via `message.from`, not
 * hardcoded here — this class is a pure transport, no business policy.
 */
const RESEND_API_URL = "https://api.resend.com/emails";

export class ResendEmailService implements EmailService {
  constructor(private readonly apiKey: string) {}

  async send(message: OutboundEmailMessage): Promise<EmailSendResult> {
    try {
      const response = await fetch(RESEND_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: message.from,
          to: [message.to],
          subject: message.subject,
          text: message.text,
          ...(message.html ? { html: message.html } : {}),
          ...(message.replyTo ? { reply_to: message.replyTo } : {}),
        }),
      });

      let body: any = null;
      try {
        body = await response.json();
      } catch {
        body = null;
      }

      if (!response.ok) {
        return {
          providerMessageId: null,
          status: "failed",
          error: body?.message ?? `Resend API returned HTTP ${response.status}.`,
        };
      }

      return { providerMessageId: typeof body?.id === "string" ? body.id : null, status: "sent" };
    } catch (err) {
      return {
        providerMessageId: null,
        status: "failed",
        error: err instanceof Error ? err.message : "Unknown network error sending via Resend.",
      };
    }
  }
}
