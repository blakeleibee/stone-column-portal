export interface StorageAdapterDownloadOptions {
  /** When present, the returned URL must stop working after this many
   *  seconds — a real, time-limited signed download, not a permanent
   *  link. Required for category='w9' vendor documents (Package P5.1,
   *  P5-EXTENSION-PACKAGES-DESIGN.md Section 9 item 4); omitted, this
   *  preserves every existing caller's current unsigned-URL behavior
   *  unchanged. */
  expiresInSeconds?: number;
}

export interface StorageAdapter {
  upload(key: string, data: Buffer, mimeType: string): Promise<void>;
  getDownloadUrl(key: string, options?: StorageAdapterDownloadOptions): Promise<string>;
  delete(key: string): Promise<void>;
}
