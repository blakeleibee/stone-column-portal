import { mkdir, writeFile, unlink, readFile } from "node:fs/promises";
import { createHmac, timingSafeEqual } from "node:crypto";
import path from "node:path";
import type { StorageAdapter, StorageAdapterDownloadOptions } from "./StorageAdapter";

const LOCAL_STORAGE_ROOT = path.join(process.cwd(), "..", "..", ".local-storage");

/** Dev-only signing secret for expiring local download links (Package
 *  P5.1's W-9 requirement — StorageAdapter.getDownloadUrl's new
 *  `expiresInSeconds` option). A production adapter (OneDrive/Microsoft
 *  Graph) gets its short-lived download URL from the provider itself
 *  (@microsoft.graph.downloadUrl) and never needs this — this key only
 *  exists so the LOCAL FILESYSTEM dev fallback can honor the same
 *  "real, time-limited signed URL" contract without a real cloud
 *  storage provider behind it. Falls back to a fixed dev-only literal
 *  when unset (documented, not a security-sensitive default: local
 *  filesystem storage is never used in production — getStorageAdapter()
 *  only returns this class when MICROSOFT_GRAPH_CLIENT_ID is absent). */
function getSigningSecret(): string {
  return process.env.STORAGE_SIGNING_SECRET || "dev-only-local-storage-signing-secret-do-not-use-in-production";
}

function sign(key: string, expiresAt: number): string {
  return createHmac("sha256", getSigningSecret()).update(`${key}:${expiresAt}`).digest("hex");
}

/** Verifies a signed local-storage download URL's `key`/`expires`/`sig`
 *  query params. Exported so the Route Handler that actually streams
 *  the file bytes (apps/web/app/api/vendors/documents/signed-download/
 *  route.ts) can validate a request against the exact same signing
 *  scheme getDownloadUrl() used to produce it, without either side
 *  duplicating the HMAC logic. Constant-time signature comparison
 *  (timingSafeEqual) — the same defense-in-depth posture every other
 *  security-sensitive comparison in this codebase already uses. */
export function verifySignedLocalDownload(key: string, expiresAtRaw: string, signature: string): { ok: true } | { ok: false; error: string } {
  const expiresAt = Number(expiresAtRaw);
  if (!Number.isFinite(expiresAt)) return { ok: false, error: "Malformed expiry." };
  if (Date.now() > expiresAt) return { ok: false, error: "This download link has expired." };

  const expected = sign(key, expiresAt);
  // Uint8Array.from(...), not a bare Buffer, satisfies timingSafeEqual's
  // ArrayBufferView typing under this repo's pinned @types/node — Buffer
  // itself is a Uint8Array at runtime either way.
  const expectedBuf = Uint8Array.from(Buffer.from(expected, "hex"));
  const actualBuf = Uint8Array.from(Buffer.from(signature, "hex"));
  if (expectedBuf.length !== actualBuf.length || !timingSafeEqual(expectedBuf, actualBuf)) {
    return { ok: false, error: "Invalid download link signature." };
  }
  return { ok: true };
}

/** Resolves `key` under LOCAL_STORAGE_ROOT and rejects any path that
 *  would escape it (e.g. `../../etc/passwd`-style traversal). No route
 *  in this package passes an untrusted `key` today (the only current
 *  consumer, getDownloadUrl, only ever receives a key already read from
 *  the database post-authorization) -- this is defense-in-depth for
 *  whenever a future upload route passes one. */
function resolveWithinRoot(key: string): string {
  const resolvedRoot = path.resolve(LOCAL_STORAGE_ROOT);
  const resolvedPath = path.resolve(resolvedRoot, key);
  if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(resolvedRoot + path.sep)) {
    throw new Error(`Storage key "${key}" resolves outside the local storage root — rejected.`);
  }
  return resolvedPath;
}

/** Dev-only adapter. `getDownloadUrl` doesn't return a real signed URL
 *  (there's no public server for one) — it returns the internal
 *  Route Handler path that streams the file after its own
 *  canViewDocument() check, matching "no public access to private
 *  project files by default" even in local dev. */
export class LocalFilesystemStorageAdapter implements StorageAdapter {
  async upload(key: string, data: Buffer): Promise<void> {
    const fullPath = resolveWithinRoot(key);
    await mkdir(path.dirname(fullPath), { recursive: true });
    await writeFile(fullPath, new Uint8Array(data));
  }

  async getDownloadUrl(key: string, options?: StorageAdapterDownloadOptions): Promise<string> {
    if (!options?.expiresInSeconds) {
      // Unchanged from before this package — every existing caller that
      // doesn't ask for an expiry keeps getting the same unsigned path.
      return `/api/documents/download-by-key?key=${encodeURIComponent(key)}`;
    }
    const expiresAt = Date.now() + options.expiresInSeconds * 1000;
    const sig = sign(key, expiresAt);
    const params = new URLSearchParams({ key, expires: String(expiresAt), sig });
    return `/api/vendors/documents/signed-download?${params.toString()}`;
  }

  async delete(key: string): Promise<void> {
    await unlink(resolveWithinRoot(key));
  }

  async readLocal(key: string): Promise<Buffer> {
    return readFile(resolveWithinRoot(key));
  }
}
