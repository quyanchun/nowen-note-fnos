import { Capacitor, registerPlugin } from "@capacitor/core";
import type { PluginListenerHandle } from "@capacitor/core";

export type AndroidShareItemStatus = "ready" | "blocked" | "error";

export interface AndroidShareItem {
  id: string;
  name: string;
  declaredMimeType: string;
  mimeType: string;
  sourceSize?: number;
  size: number;
  sha256?: string;
  status: AndroidShareItemStatus;
  error?: string;
  mimeMismatch?: boolean;
}

export interface AndroidSharePayload {
  id: string;
  action: string;
  createdAt: number;
  sourcePackage: string;
  sourceLabel: string;
  subject: string;
  text: string;
  url: string;
  captureError?: string;
  items: AndroidShareItem[];
}

export interface AndroidSharePendingResult {
  payloads: AndroidSharePayload[];
  maxFileBytes: number;
}

export interface AndroidShareUploadProgress {
  itemId: string;
  bytesSent: number;
  totalBytes: number;
  percent: number;
}

export interface AndroidShareUploadResult {
  success: true;
  response: {
    id: string;
    url: string;
    mimeType: string;
    size: number;
    filename: string;
    category: "image" | "file";
    deduplicated?: boolean;
  };
}

interface ShareImportPlugin {
  getPending(): Promise<AndroidSharePendingResult>;
  discardPayload(options: { payloadId: string }): Promise<{ ok: boolean }>;
  completeItems(options: {
    payloadId: string;
    itemIds: string[];
    consumeText?: boolean;
  }): Promise<{ ok: boolean }>;
  uploadItem(options: {
    payloadId: string;
    itemId: string;
    apiBaseUrl: string;
    token: string;
    destination: "files" | "attachment";
    workspaceId?: string;
    noteId?: string;
    folderId?: string;
  }): Promise<AndroidShareUploadResult>;
  cancelUpload(options: { itemId: string }): Promise<{ ok: boolean; cancelled: boolean }>;
  addListener(
    eventName: "shareReceived",
    listener: (event: { payloadId: string }) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: "uploadProgress",
    listener: (event: AndroidShareUploadProgress) => void,
  ): Promise<PluginListenerHandle>;
}

const ShareImport = registerPlugin<ShareImportPlugin>("ShareImport");

export function isAndroidShareImportAvailable(): boolean {
  return Capacitor.isNativePlatform()
    && Capacitor.getPlatform() === "android"
    && Capacitor.isPluginAvailable("ShareImport");
}

export async function getPendingAndroidShares(): Promise<AndroidSharePendingResult> {
  if (!isAndroidShareImportAvailable()) return { payloads: [], maxFileBytes: 0 };
  return ShareImport.getPending();
}

export async function uploadAndroidShareItem(options: {
  payloadId: string;
  itemId: string;
  apiBaseUrl: string;
  token: string;
  destination: "files" | "attachment";
  workspaceId?: string;
  noteId?: string;
  folderId?: string;
}): Promise<AndroidShareUploadResult> {
  return ShareImport.uploadItem(options);
}

export async function completeAndroidShareItems(
  payloadId: string,
  itemIds: string[],
  consumeText = false,
): Promise<void> {
  await ShareImport.completeItems({ payloadId, itemIds, consumeText });
}

export async function discardAndroidSharePayload(payloadId: string): Promise<void> {
  await ShareImport.discardPayload({ payloadId });
}

export async function cancelAndroidShareUpload(itemId: string): Promise<boolean> {
  const result = await ShareImport.cancelUpload({ itemId });
  return result.cancelled;
}

export async function onAndroidShareReceived(
  listener: (payloadId: string) => void,
): Promise<PluginListenerHandle | null> {
  if (!isAndroidShareImportAvailable()) return null;
  return ShareImport.addListener("shareReceived", (event) => listener(event.payloadId));
}

export async function onAndroidShareUploadProgress(
  listener: (event: AndroidShareUploadProgress) => void,
): Promise<PluginListenerHandle | null> {
  if (!isAndroidShareImportAvailable()) return null;
  return ShareImport.addListener("uploadProgress", listener);
}
