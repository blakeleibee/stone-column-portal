export interface StorageAdapter {
  upload(key: string, data: Buffer, mimeType: string): Promise<void>;
  getDownloadUrl(key: string): Promise<string>;
  delete(key: string): Promise<void>;
}
