import { NextResponse } from "next/server";
import { verifySvixSignature } from "../../../../../../packages/02-app-shell/src/services/email/svixSignature";
import { extractReplyToken } from "../../../../../../packages/02-app-shell/src/services/email/constants";
import {
  resolveInboundReplyToken,
  verifySenderMatchesVendor,
  findEntityMessageByProviderMessageId,
  insertInboundMessage,
  quarantineInboundMessage,
} from "../../../../../../packages/02-app-shell/src/services/correspondenceService";
import { createServiceRoleSupabaseClient } from "../../../../src/server/supabase/serviceRoleClient";

/**
 * POST /api/webhooks/resend — inbound Resend/Svix webhook. Handles
 * `email.received` events for the inbound-reply-routing path described
 * in docs/production-build/P5-EXTENSION-PACKAGES-DESIGN.md Section 5,
 * Part E, and schema/028's own header comment.
 *
 * HONESTY DISCLOSURE (per the owner's explicit instruction): this route
 * cannot be exercised end-to-end against a genuine Resend-signed
 * payload in this environment — RESEND_WEBHOOK_SECRET is not configured
 * (confirmed absent, same as RESEND_API_KEY). Every code path below IS
 * real, production code, not a stub — verified instead via a directly
 * simulated, correctly-Svix-signed POST to this exact route in local
 * dev (see scripts/db/live-p5.2-phase-d-webhook-checkpoint.mjs), which
 * this phase's report describes as exactly what it is: a simulated
 * request proving the route's own logic, not a real end-to-end Resend
 * delivery.
 *
 * STATUS CODE CONTRACT (matters for real delivery behavior once live):
 *  - 200 for anything this route genuinely UNDERSTOOD and HANDLED, even
 *    by quarantining it (an invalid signature, an unmatched/revoked
 *    token, a sender mismatch, a malformed payload, or a duplicate
 *    redelivery) — none of these are fixed by Resend retrying.
 *  - 500 ONLY for something Resend retrying might actually fix: a
 *    transient database error, or this server having no
 *    RESEND_WEBHOOK_SECRET configured AT ALL (a real misconfiguration,
 *    not a business-logic outcome worth quarantining forever).
 *
 * Uses the service-role client throughout (see serviceRoleClient.ts's
 * own doc comment) — this request carries no Supabase Auth session at
 * all, the first "verified external webhook" case TARGET-
 * ARCHITECTURE.md §5.2 names explicitly. "Verified" is load-bearing:
 * nothing below is trusted until the Svix signature check passes.
 */
export async function POST(request: Request) {
  const webhookSecret = process.env.RESEND_WEBHOOK_SECRET;
  if (!webhookSecret) {
    // A real misconfiguration on OUR side, not a business-logic outcome
    // — deliberately NOT quarantined (that table is for payloads we
    // genuinely evaluated and made a routing decision about). Resend
    // will retry, which is the correct behavior once the secret is set.
    console.error("[webhooks/resend] RESEND_WEBHOOK_SECRET is not configured — refusing to process any inbound webhook.");
    return NextResponse.json({ error: "Inbound email webhook is not configured." }, { status: 500 });
  }

  const rawBody = await request.text();
  const svixId = request.headers.get("svix-id");
  const svixTimestamp = request.headers.get("svix-timestamp");
  const svixSignature = request.headers.get("svix-signature");

  const supabase = createServiceRoleSupabaseClient();

  const verification = verifySvixSignature({ svixId, svixTimestamp, svixSignature }, rawBody, webhookSecret);
  if (!verification.valid) {
    await quarantineInboundMessage(supabase, {
      reason: "signature_invalid",
      rawPayload: { headers: { svixId, svixTimestamp, hasSignature: !!svixSignature }, reason: verification.reason, bodyPreview: rawBody.slice(0, 2000) },
    });
    return NextResponse.json({ status: "quarantined", reason: "signature_invalid" }, { status: 200 });
  }

  let event: any;
  try {
    event = JSON.parse(rawBody);
  } catch {
    await quarantineInboundMessage(supabase, {
      reason: "malformed_payload",
      rawPayload: { bodyPreview: rawBody.slice(0, 2000), parseError: true },
    });
    return NextResponse.json({ status: "quarantined", reason: "malformed_payload" }, { status: 200 });
  }

  // Only `email.received` is implemented in this phase — every other
  // Resend event type (email.sent/delivered/bounced/complained, etc.)
  // is acknowledged as understood-but-not-actionable here, never
  // quarantined (quarantine is specifically for inbound messages this
  // route COULD have routed but couldn't safely).
  if (event?.type !== "email.received") {
    return NextResponse.json({ status: "ignored", type: event?.type ?? null }, { status: 200 });
  }

  // Idempotency FIRST, before any other business-logic evaluation — a
  // redelivered webhook for an already-fully-processed message is a
  // pure no-op, never re-quarantined or re-routed.
  if (svixId) {
    const existing = await findEntityMessageByProviderMessageId(supabase, svixId);
    if (existing) {
      return NextResponse.json({ status: "duplicate", messageId: existing.id }, { status: 200 });
    }
  }

  const data = event.data ?? {};
  const toAddresses: string[] = Array.isArray(data.to) ? data.to : typeof data.to === "string" ? [data.to] : [];
  const fromAddress: string = typeof data.from === "string" ? data.from : "";
  const subject: string | null = typeof data.subject === "string" ? data.subject : null;
  const body: string = typeof data.text === "string" ? data.text : typeof data.html === "string" ? data.html : "";

  const replyToken = toAddresses.map((addr) => extractReplyToken(addr)).find((token): token is string => !!token) ?? null;

  if (!replyToken) {
    await quarantineInboundMessage(supabase, {
      reason: "malformed_payload",
      rawPayload: { to: toAddresses, from: fromAddress, subject, text: body, svixId },
    });
    return NextResponse.json({ status: "quarantined", reason: "malformed_payload" }, { status: 200 });
  }

  let resolution;
  try {
    resolution = await resolveInboundReplyToken(supabase, replyToken);
  } catch (err) {
    console.error("[webhooks/resend] transient error resolving reply token", err);
    return NextResponse.json({ error: "Transient error — retry." }, { status: 500 });
  }

  if (resolution.kind === "unmatched_token") {
    await quarantineInboundMessage(supabase, {
      reason: "unmatched_token",
      rawPayload: { to: toAddresses, from: fromAddress, subject, text: body, svixId, token: replyToken },
    });
    return NextResponse.json({ status: "quarantined", reason: "unmatched_token" }, { status: 200 });
  }

  const orgId = await resolveOrgIdForBidPackage(supabase, resolution.bidPackageId);

  if (resolution.kind === "revoked_vendor") {
    await quarantineInboundMessage(supabase, {
      reason: "revoked_vendor",
      rawPayload: { to: toAddresses, from: fromAddress, subject, text: body, svixId, token: replyToken },
      orgId,
      bidPackageId: resolution.bidPackageId,
      vendorId: resolution.vendorId,
    });
    return NextResponse.json({ status: "quarantined", reason: "revoked_vendor" }, { status: 200 });
  }

  let senderMatches: boolean;
  try {
    senderMatches = await verifySenderMatchesVendor(supabase, resolution.vendorId, fromAddress);
  } catch (err) {
    console.error("[webhooks/resend] transient error verifying sender", err);
    return NextResponse.json({ error: "Transient error — retry." }, { status: 500 });
  }

  if (!senderMatches) {
    await quarantineInboundMessage(supabase, {
      reason: "sender_mismatch",
      rawPayload: { to: toAddresses, from: fromAddress, subject, text: body, svixId, token: replyToken },
      orgId,
      bidPackageId: resolution.bidPackageId,
      vendorId: resolution.vendorId,
    });
    return NextResponse.json({ status: "quarantined", reason: "sender_mismatch" }, { status: 200 });
  }

  const recipientAddress = toAddresses.find((addr) => extractReplyToken(addr) === replyToken) ?? toAddresses[0] ?? "";

  const insertResult = await insertInboundMessage(supabase, {
    bidPackageId: resolution.bidPackageId,
    vendorId: resolution.vendorId,
    sender: fromAddress,
    recipient: recipientAddress,
    subject,
    body: body || "(empty message body)",
    providerMessageId: svixId,
  });

  if ("error" in insertResult) {
    console.error("[webhooks/resend] transient error inserting inbound message", insertResult.error);
    return NextResponse.json({ error: "Transient error — retry." }, { status: 500 });
  }
  if ("duplicate" in insertResult) {
    return NextResponse.json({ status: "duplicate" }, { status: 200 });
  }
  return NextResponse.json({ status: "routed", messageId: insertResult.id }, { status: 200 });
}

async function resolveOrgIdForBidPackage(supabase: ReturnType<typeof createServiceRoleSupabaseClient>, bidPackageId: string): Promise<string | null> {
  const { data } = await supabase.from("bid_packages").select("project_id, projects(org_id)").eq("id", bidPackageId).maybeSingle();
  return (data as any)?.projects?.org_id ?? null;
}
