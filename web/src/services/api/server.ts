import i18n from "@/i18n";
import { useStorageStore } from "@/stores/use-storage-store";

export type AdminUser = { id: string; username: string };
export type ServerRecord<T = unknown> = { key: string; value: T | null; revision: number; deleted?: boolean };
export type ServerRecords = { revision: number; records: ServerRecord[] };
export type ServerMedia = { key: string; kind: "image" | "media"; mimeType: string; bytes: number; previewBytes: number; previewVersion: number; hasPreview: boolean; revision: number; cleared: boolean };
export type ServerStorageUsage = { images: number; previews: number; imageBytes: number; previewBytes: number; mediaBytes: number; databaseBytes: number; uploadBytes: number; totalBytes: number };

export class ServerApiError extends Error {
    constructor(public status: number, public code: string, message: string) { super(message); }
}

let controller = new AbortController();
let epoch = 0;
let active = false;
let writable = false;
const media = new Map<string, ServerMedia>();
const tasks = new Set<Promise<unknown>>();
export const serverSessionEpoch = () => epoch;
export const serverSessionSignal = (signal?: AbortSignal) => active ? signal ? AbortSignal.any([controller.signal, signal]) : controller.signal : AbortSignal.abort();
export const canWriteServerStorage = () => active && writable;
export function allowServerWrites(value: boolean) { writable = value; }

export function resetServerSession(enabled = false) {
    controller.abort();
    controller = new AbortController();
    epoch += 1;
    active = enabled;
    writable = false;
    media.clear();
    tasks.clear();
    useStorageStore.setState({ pending: 0, canvasQueued: false, error: "", failedWrites: {}, sessionExpired: false });
}

async function responseFor(path: string, init: RequestInit, protectedRequest: boolean) {
    if (protectedRequest && !active) throw new DOMException("Session ended", "AbortError");
    const currentEpoch = epoch;
    const signal = init.signal ? AbortSignal.any([controller.signal, init.signal]) : controller.signal;
    let response: Response;
    try { response = await fetch(`/api${path}`, { ...init, credentials: "same-origin", cache: "no-store", signal }); }
    catch (error) { if (signal.aborted) throw new DOMException("Request aborted", "AbortError"); throw new ServerApiError(0, "SERVER_UNAVAILABLE", i18n.t("server.unavailable")); }
    if (signal.aborted || (protectedRequest && currentEpoch !== epoch)) throw new DOMException("Session ended", "AbortError");
    if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: { code?: string; message?: string } } | null;
        const code = body?.error?.code || "STORAGE_FAILED";
        if (signal.aborted || (protectedRequest && currentEpoch !== epoch)) throw new DOMException("Session ended", "AbortError");
        if (response.status === 401 && protectedRequest) useStorageStore.setState({ sessionExpired: true });
        const message = i18n.t(`server.errors.${code}`, { defaultValue: body?.error?.message || i18n.t("server.unavailable") });
        throw new ServerApiError(response.status, code, message);
    }
    return response;
}

async function request<T>(path: string, init: RequestInit = {}, protectedRequest = true): Promise<T> {
    if (protectedRequest && ["POST", "PUT", "DELETE"].includes(init.method || "GET")) return trackServerTask(() => parseResponse<T>(path, init, protectedRequest));
    return parseResponse<T>(path, init, protectedRequest);
}

async function parseResponse<T>(path: string, init: RequestInit, protectedRequest: boolean): Promise<T> {
    const currentEpoch = epoch;
    const response = await responseFor(path, init, protectedRequest);
    if (response.status === 204) return undefined as T;
    const result = await response.json().catch(() => null) as { data: T } | null;
    if (currentEpoch !== epoch || init.signal?.aborted) throw new DOMException("Session ended", "AbortError");
    if (!result || typeof result !== "object" || !("data" in result)) throw new ServerApiError(0, "SERVER_UNAVAILABLE", i18n.t("server.unavailable"));
    return result.data;
}

export function trackServerTask<T>(operation: () => Promise<T>) {
    const currentEpoch = epoch;
    useStorageStore.setState((state) => ({ pending: state.pending + 1 }));
    const task = Promise.resolve().then(() => {
        if (currentEpoch !== epoch) throw new DOMException("Session ended", "AbortError");
        return operation();
    }).finally(() => {
        tasks.delete(task);
        if (currentEpoch === epoch) useStorageStore.setState((state) => ({ pending: state.pending - 1 }));
    });
    tasks.add(task);
    void task.catch(() => undefined);
    return task;
}

export async function flushServerTasks() {
    while (tasks.size) await Promise.all([...tasks]);
}

const jsonBody = (value: unknown) => ({ headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) });
const recordPath = (namespace: string, key?: string) => `/records/${encodeURIComponent(namespace)}${key === undefined ? "" : `/${encodeURIComponent(key)}`}`;
export const readServerSession = () => request<{ user: AdminUser | null }>("/auth/session", {}, false);
export const loginServer = (username: string, password: string) => request<{ user: AdminUser }>("/auth/login", { method: "POST", ...jsonBody({ username, password }) }, false);
export const logoutServer = () => request<void>("/auth/session", { method: "DELETE" }, false);
export const readServerRecord = (namespace: string, key: string) => request<ServerRecord>(recordPath(namespace, key));
export const readServerRecords = (namespace: string) => request<ServerRecords>(recordPath(namespace));
export function writeServerRecord(namespace: string, key: string, value: unknown, revision: number, deleted = false) {
    return request<ServerRecord>(recordPath(namespace, key), { method: deleted ? "DELETE" : "PUT", ...(deleted ? {} : jsonBody({ value })), headers: { ...(deleted ? {} : { "Content-Type": "application/json" }), "If-Match": String(revision) } });
}
export function replaceServerRecords(namespace: string, records: Array<{ key: string; value: unknown }>, revision: number) {
    return request<ServerRecords>(recordPath(namespace), { method: "PUT", ...jsonBody({ records }), headers: { "Content-Type": "application/json", "If-Match": String(revision) } });
}

export async function refreshServerMedia() {
    const currentEpoch = epoch;
    const items = await request<ServerMedia[]>("/media");
    if (currentEpoch !== epoch) throw new DOMException("Session ended", "AbortError");
    media.clear();
    items.forEach((item) => media.set(item.key, item));
}

export const cachedServerMedia = () => [...media.values()];
export const imageWasCleared = (key?: string) => Boolean(key && media.get(key)?.cleared);
export async function serverMediaInfo(key: string) {
    const currentEpoch = epoch;
    const cached = media.get(key);
    if (cached) return cached;
    const item = await request<ServerMedia | null>(`/media/${encodeURIComponent(key)}`);
    if (currentEpoch !== epoch) throw new DOMException("Session ended", "AbortError");
    if (item) media.set(key, item);
    return item;
}
export function serverMediaUrl(key: string, preview = false) {
    return `/api/media/${encodeURIComponent(key)}/${preview ? "preview" : "original"}?v=${media.get(key)?.revision || 0}`;
}
export function isServerMediaUrl(value: string) {
    const url = new URL(value, window.location.origin);
    return url.origin === window.location.origin && url.pathname.startsWith("/api/media/");
}

export async function readServerMediaUrl(value: string, signal?: AbortSignal) {
    const currentEpoch = epoch;
    const url = new URL(value, window.location.origin);
    const response = await responseFor(`${url.pathname.slice(4)}${url.search}`, { signal }, true);
    const blob = await response.blob();
    if (currentEpoch !== epoch) throw new DOMException("Session ended", "AbortError");
    return blob;
}

export async function readServerMediaBlob(key: string, preview = false, signal?: AbortSignal) {
    if (imageWasCleared(key)) return null;
    try {
        const currentEpoch = epoch;
        const response = await responseFor(`/media/${encodeURIComponent(key)}/${preview ? "preview" : "original"}`, { signal }, true);
        const blob = await response.blob();
        if (currentEpoch !== epoch) throw new DOMException("Session ended", "AbortError");
        return blob;
    } catch (error) {
        if (error instanceof ServerApiError && error.status === 410) {
            const item = media.get(key);
            if (item) media.set(key, { ...item, cleared: true });
            return null;
        }
        if (error instanceof ServerApiError && error.status === 404) return null;
        throw error;
    }
}

export async function writeServerMedia(key: string, blob?: Blob, preview = false, signal?: AbortSignal) {
    const currentEpoch = epoch;
    const current = await serverMediaInfo(key);
    if (currentEpoch !== epoch) throw new DOMException("Session ended", "AbortError");
    const data = new FormData();
    if (blob) data.append("file", blob, preview ? "preview.webp" : "media");
    const item = await request<ServerMedia>(`/media/${encodeURIComponent(key)}${preview ? "/preview" : ""}`, { method: "PUT", body: data, headers: { "If-Match": String(current?.revision ?? 0) }, signal });
    if (currentEpoch !== epoch) throw new DOMException("Session ended", "AbortError");
    media.set(key, item);
    return item;
}

export async function deleteServerMedia(key: string) {
    const currentEpoch = epoch;
    const current = await serverMediaInfo(key);
    if (currentEpoch !== epoch) throw new DOMException("Session ended", "AbortError");
    if (!current || current.cleared) return false;
    const result = await request<{ deleted: boolean }>(`/media/${encodeURIComponent(key)}`, { method: "DELETE", headers: { "If-Match": String(current.revision) } });
    if (currentEpoch !== epoch) throw new DOMException("Session ended", "AbortError");
    if (result.deleted) media.delete(key);
    return result.deleted;
}

export const readServerStorageUsage = () => request<ServerStorageUsage>("/storage");
export const clearServerImages = () => request<ServerStorageUsage>("/storage/images", { method: "DELETE" });
