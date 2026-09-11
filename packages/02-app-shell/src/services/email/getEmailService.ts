import type { EmailService } from "./EmailService";
import { NullEmailService } from "./NullEmailService";
import { ResendEmailService } from "./ResendEmailService";

/**
 * The "zero code changes to activate" mechanism the owner explicitly
 * required: this is the ONLY place in the app that decides which
 * EmailService implementation is live, mirroring apps/web/src/server/
 * storage/getStorageAdapter.ts's own established shape exactly
 * (env-var presence selects the real implementation; its absence
 * selects an honest fallback — never a hidden third state). The moment
 * RESEND_API_KEY is set in the real environment, every caller of
 * getEmailService() starts sending for real, with no other file in this
 * codebase needing to change.
 */
export function getEmailService(): EmailService {
  const apiKey = process.env.RESEND_API_KEY;
  if (apiKey) {
    return new ResendEmailService(apiKey);
  }
  return new NullEmailService();
}
