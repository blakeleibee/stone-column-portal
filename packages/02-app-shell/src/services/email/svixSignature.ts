import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * P5.2 Phase D — real Svix webhook signature verification (Resend signs
 * every webhook delivery using Svix). Implemented for real per the
 * owner's explicit instruction, even though it cannot be exercised
 * against a genuine Resend-signed payload in this environment (no
 * RESEND_WEBHOOK_SECRET is configured) — this file's own test suite
 * (svixSignature_unit.ts) computes REAL valid signatures itself (it
 * controls the secret, exactly like a real Resend project would) to
 * prove both the accept and reject paths actually work, not merely
 * "compiles."
 *
 * Algorithm (Svix's own documented scheme, not guessed):
 *  - The secret arrives prefixed `whsec_`; the part after the prefix is
 *    base64-encoded HMAC key material.
 *  - The signed content is exactly `${svixId}.${svixTimestamp}.${body}`
 *    (raw request body bytes, as a string — the caller must pass the
 *    UNPARSED body, never a re-serialized JSON.stringify(JSON.parse(...))
 *    of it, or the signature will never match).
 *  - HMAC-SHA256 over that content, base64-encoded, compared against
 *    the svix-signature header's value, which is a space-separated list
 *    of `v1,<base64signature>` entries (Svix supports signing with
 *    multiple keys during rotation — any one match is a valid
 *    signature).
 *  - svix-timestamp must be within a tolerance window of "now" (5
 *    minutes, matching Svix's own recommended default) to reject a
 *    replayed-but-otherwise-validly-signed old payload.
 */
export interface SvixHeaders {
  svixId: string | null;
  svixTimestamp: string | null;
  svixSignature: string | null;
}

export interface SvixVerificationResult {
  valid: boolean;
  reason?: string;
}

const TOLERANCE_SECONDS = 5 * 60;

function base64ToBuffer(value: string): Buffer | null {
  try {
    return Buffer.from(value, "base64");
  } catch {
    return null;
  }
}

/** Node's crypto typings (in the @types/node version this monorepo
 *  pins) declare createHmac/timingSafeEqual against `Uint8Array<
 *  ArrayBuffer>` specifically, which a plain `Buffer` (typed as
 *  `Uint8Array<ArrayBufferLike>`, i.e. possibly backed by a
 *  SharedArrayBuffer) doesn't structurally satisfy — even though every
 *  Buffer this file ever constructs (via Buffer.from) is really backed
 *  by a plain ArrayBuffer at runtime. Re-wrapping in `new Uint8Array()`
 *  copies into a definitely-plain-ArrayBuffer-backed view, satisfying
 *  the stricter type with zero behavioral change. */
function toHmacBytes(buffer: Buffer): Uint8Array {
  return new Uint8Array(buffer);
}

export function verifySvixSignature(
  headers: SvixHeaders,
  rawBody: string,
  secret: string,
  nowMs: number = Date.now()
): SvixVerificationResult {
  const { svixId, svixTimestamp, svixSignature } = headers;
  if (!svixId || !svixTimestamp || !svixSignature) {
    return { valid: false, reason: "Missing one or more required svix-id/svix-timestamp/svix-signature headers." };
  }

  const timestampSeconds = Number(svixTimestamp);
  if (!Number.isFinite(timestampSeconds)) {
    return { valid: false, reason: "Malformed svix-timestamp header (not a number)." };
  }
  const nowSeconds = Math.floor(nowMs / 1000);
  if (Math.abs(nowSeconds - timestampSeconds) > TOLERANCE_SECONDS) {
    return { valid: false, reason: `svix-timestamp is outside the ${TOLERANCE_SECONDS}-second tolerance window.` };
  }

  const secretMaterial = secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret;
  const secretBytes = base64ToBuffer(secretMaterial);
  if (!secretBytes) {
    return { valid: false, reason: "Configured webhook secret is not valid base64." };
  }

  const signedContent = `${svixId}.${svixTimestamp}.${rawBody}`;
  const expectedSignature = createHmac("sha256", toHmacBytes(secretBytes)).update(signedContent).digest();

  const candidates = svixSignature
    .split(" ")
    .map((entry) => entry.split(",")[1])
    .filter((value): value is string => !!value);

  for (const candidate of candidates) {
    const candidateBuffer = base64ToBuffer(candidate);
    if (!candidateBuffer) continue;
    if (candidateBuffer.length !== expectedSignature.length) continue;
    if (timingSafeEqual(toHmacBytes(candidateBuffer), toHmacBytes(expectedSignature))) {
      return { valid: true };
    }
  }

  return { valid: false, reason: "No provided signature matched the expected HMAC." };
}

/** Test-only convenience — computes a real, valid svix-signature header
 *  value for a given id/timestamp/body/secret, so this file's own unit
 *  tests (and the webhook route's own "simulate a real signed POST"
 *  hosted-dev verification step) can construct a genuinely valid signed
 *  request without a real Resend/Svix account. */
export function signSvixPayloadForTesting(svixId: string, svixTimestamp: string, rawBody: string, secret: string): string {
  const secretMaterial = secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret;
  const secretBytes = Buffer.from(secretMaterial, "base64");
  const signedContent = `${svixId}.${svixTimestamp}.${rawBody}`;
  const signature = createHmac("sha256", toHmacBytes(secretBytes)).update(signedContent).digest("base64");
  return `v1,${signature}`;
}
