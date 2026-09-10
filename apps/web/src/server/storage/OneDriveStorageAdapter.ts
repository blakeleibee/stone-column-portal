import type { StorageAdapter, StorageAdapterDownloadOptions } from "./StorageAdapter";

/**
 * INTERFACE BOUNDARY ONLY — per TARGET-ARCHITECTURE.md §8-9, OneDrive/
 * SharePoint is the intended production file store (Microsoft Graph
 * API, server-side only). No Graph credentials are available or
 * configured in this package; every method below documents the
 * intended call rather than making it, exactly matching
 * SupabaseFinancialRepository's pre-P1 stub pattern.
 *
 * Required config (documented, not yet read anywhere):
 *   MICROSOFT_GRAPH_CLIENT_ID, MICROSOFT_GRAPH_CLIENT_SECRET,
 *   MICROSOFT_GRAPH_TENANT_ID (already present as empty placeholders
 *   in .env.example since Package P0).
 */
export class OneDriveStorageAdapter implements StorageAdapter {
  async upload(key: string, _data: Buffer, _mimeType: string): Promise<void> {
    // PUT https://graph.microsoft.com/v1.0/drives/{drive-id}/root:/{key}:/content
    throw notImplemented("upload", key);
  }

  async getDownloadUrl(key: string, _options?: StorageAdapterDownloadOptions): Promise<string> {
    // GET https://graph.microsoft.com/v1.0/drives/{drive-id}/root:/{key}
    // then use the returned @microsoft.graph.downloadUrl (short-lived,
    // pre-authenticated) — never the item's permanent webUrl. Graph's
    // own download URLs already expire on their own (typically ~1 hour)
    // regardless of `_options.expiresInSeconds` — a real implementation
    // has no lever to shorten that further, so this parameter would be
    // accepted but not independently enforced, same as any other
    // provider-managed expiry.
    throw notImplemented("getDownloadUrl", key);
  }

  async delete(key: string): Promise<void> {
    // DELETE https://graph.microsoft.com/v1.0/drives/{drive-id}/root:/{key}
    throw notImplemented("delete", key);
  }
}

function notImplemented(method: string, key: string): Error {
  return new Error(
    `OneDriveStorageAdapter.${method}("${key}") is not implemented — no Microsoft Graph credentials are configured. See the comment above this class for the intended integration.`
  );
}
