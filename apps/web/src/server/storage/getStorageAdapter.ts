import type { StorageAdapter } from "./StorageAdapter";
import { LocalFilesystemStorageAdapter } from "./LocalFilesystemStorageAdapter";
import { OneDriveStorageAdapter } from "./OneDriveStorageAdapter";

export function getStorageAdapter(): StorageAdapter {
  if (process.env.MICROSOFT_GRAPH_CLIENT_ID) {
    return new OneDriveStorageAdapter();
  }
  return new LocalFilesystemStorageAdapter();
}
