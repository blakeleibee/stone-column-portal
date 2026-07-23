import { mkdir, writeFile, unlink, readFile } from "node:fs/promises";
import path from "node:path";
import type { StorageAdapter } from "./StorageAdapter";

const LOCAL_STORAGE_ROOT = path.join(process.cwd(), "..", "..", ".local-storage");

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

  async getDownloadUrl(key: string): Promise<string> {
    return `/api/documents/download-by-key?key=${encodeURIComponent(key)}`;
  }

  async delete(key: string): Promise<void> {
    await unlink(resolveWithinRoot(key));
  }

  async readLocal(key: string): Promise<Buffer> {
    return readFile(resolveWithinRoot(key));
  }
}
