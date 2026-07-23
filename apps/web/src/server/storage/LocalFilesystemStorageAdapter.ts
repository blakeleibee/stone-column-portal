import { mkdir, writeFile, unlink, readFile } from "node:fs/promises";
import path from "node:path";
import type { StorageAdapter } from "./StorageAdapter";

const LOCAL_STORAGE_ROOT = path.join(process.cwd(), "..", "..", ".local-storage");

/** Dev-only adapter. `getDownloadUrl` doesn't return a real signed URL
 *  (there's no public server for one) — it returns the internal
 *  Route Handler path that streams the file after its own
 *  canViewDocument() check, matching "no public access to private
 *  project files by default" even in local dev. */
export class LocalFilesystemStorageAdapter implements StorageAdapter {
  async upload(key: string, data: Buffer): Promise<void> {
    const fullPath = path.join(LOCAL_STORAGE_ROOT, key);
    await mkdir(path.dirname(fullPath), { recursive: true });
    await writeFile(fullPath, new Uint8Array(data));
  }

  async getDownloadUrl(key: string): Promise<string> {
    return `/api/documents/download-by-key?key=${encodeURIComponent(key)}`;
  }

  async delete(key: string): Promise<void> {
    await unlink(path.join(LOCAL_STORAGE_ROOT, key));
  }

  async readLocal(key: string): Promise<Buffer> {
    return readFile(path.join(LOCAL_STORAGE_ROOT, key));
  }
}
