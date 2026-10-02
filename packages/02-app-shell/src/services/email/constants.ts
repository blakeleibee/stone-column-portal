/**
 * P5.2 Phase D — owner-approved sending domain (P5-EXTENSION-PACKAGES-
 * DESIGN.md Section 5, Part D): a dedicated subdomain for outbound mail,
 * never the root domain, to keep bulk/transactional delivery reputation
 * isolated from Stone Column's primary domain. Reply-To addresses live
 * on this SAME subdomain (reply+<token>@notify.stonecolumn.com) — the
 * design doc's own "reply-to still resolves to a real monitored Stone
 * Column inbox" note describes where a HUMAN reply address would live,
 * which is a separate, later concern from THIS address, whose entire
 * purpose is machine-routable reply parsing via the inbound webhook.
 */
export const NOTIFICATION_EMAIL_DOMAIN = "notify.stonecolumn.com";
export const NOTIFICATION_FROM_ADDRESS = `Stone Column Custom Homes <notify@${NOTIFICATION_EMAIL_DOMAIN}>`;

export function buildReplyToAddress(token: string): string {
  return `reply+${token}@${NOTIFICATION_EMAIL_DOMAIN}`;
}

/** Reverses buildReplyToAddress() — used by the inbound webhook to pull
 *  the opaque token back out of whichever address the reply actually
 *  landed on (Resend's inbound routing delivers to the exact address a
 *  message was sent to). Returns null for anything not shaped like one
 *  of this app's own reply addresses — the webhook treats that as an
 *  unmatched token, never a crash. */
export function extractReplyToken(address: string): string | null {
  const match = /^reply\+([a-f0-9]+)@notify\.stonecolumn\.com$/i.exec(address.trim());
  return match ? match[1] : null;
}
