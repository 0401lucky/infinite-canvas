import { nanoid } from "nanoid";
import i18n from "@/i18n";
import { getImageBlob, uploadImage, type UploadedImage } from "@/services/image-storage";

import { withLocalProxy } from "@/stores/use-config-store";
import { cachedServerMedia, deleteServerMedia, imageWasCleared, isServerMediaUrl, readServerMediaBlob, readServerMediaUrl, serverMediaInfo, serverMediaUrl, serverSessionSignal, trackServerTask, writeServerMedia } from "@/services/api/server";

export type UploadedFile = { url: string; storageKey: string; bytes: number; mimeType: string; width?: number; height?: number; durationMs?: number };

const objectUrls = new Map<string, string>();
const blobs = new Map<string, Blob>();

export async function uploadMediaFile(input: string | Blob, prefix = "file", options?: { signal?: AbortSignal }): Promise<UploadedFile> {
    const signal = serverSessionSignal(options?.signal);
    return trackServerTask(async () => {
        signal.throwIfAborted();
        const response = typeof input === "string" && !isServerMediaUrl(input) ? await fetch(withLocalProxy(input), { signal }) : null;
        if (response && !response.ok) throw new Error("媒体下载失败");
        const blob = typeof input !== "string" ? input : response ? await response.blob() : await readServerMediaUrl(input, signal);
        const storageKey = `${prefix}:${nanoid()}`;
        const saved = await writeServerMedia(storageKey, blob, false, signal);
        signal.throwIfAborted();
        const url = URL.createObjectURL(blob);
        objectUrls.set(storageKey, url);
        blobs.set(storageKey, blob);
        try {
            const meta = blob.type.startsWith("video/") ? await readVideoMeta(url, signal) : blob.type.startsWith("audio/") ? await readAudioMeta(url, signal) : {};
            signal.throwIfAborted();
            return { url, storageKey, bytes: blob.size, mimeType: saved.mimeType, ...meta };
        } catch (error) {
            URL.revokeObjectURL(url);
            objectUrls.delete(storageKey);
            blobs.delete(storageKey);
            throw error;
        }
    });
}

export async function resolveMediaUrl(storageKey?: string, fallback = "") {
    if (!storageKey) return fallback;
    const stored = await serverMediaInfo(storageKey);
    if (!stored) return "";
    const cached = objectUrls.get(storageKey);
    if (cached) return cached;
    return serverMediaUrl(storageKey);
}

export async function getMediaBlob(storageKey: string, signal?: AbortSignal) {
    signal = serverSessionSignal(signal);
    signal.throwIfAborted();
    return blobs.get(storageKey) || readServerMediaBlob(storageKey, false, signal);
}

export async function readMediaBlob(media: { storageKey?: string; url?: string }) {
    const signal = serverSessionSignal();
    signal.throwIfAborted();
    if (media.storageKey) return media.storageKey.startsWith("image:") ? getImageBlob(media.storageKey, signal) : getMediaBlob(media.storageKey, signal);
    if (!media.url) return null;
    if (isServerMediaUrl(media.url)) return readServerMediaUrl(media.url, signal);
    const response = await fetch(withLocalProxy(media.url), { signal });
    if (!response.ok) throw new Error(i18n.t("server.mediaReadFailed"));
    return response.blob();
}

export async function setMediaBlob(storageKey: string, blob: Blob) {
    const signal = serverSessionSignal();
    await writeServerMedia(storageKey, blob, false, signal);
    signal.throwIfAborted();
    const url = URL.createObjectURL(blob);
    const previous = objectUrls.get(storageKey);
    if (previous) URL.revokeObjectURL(previous);
    objectUrls.set(storageKey, url);
    blobs.set(storageKey, blob);
    return url;
}

export async function deleteStoredMedia(keys: Iterable<string>) {
    await Promise.all(
        Array.from(new Set(keys)).map(async (key) => {
            if (!await deleteServerMedia(key)) return;
            const url = objectUrls.get(key);
            if (url) URL.revokeObjectURL(url);
            objectUrls.delete(key);
            blobs.delete(key);
        }),
    );
}

export async function cleanupUnusedMedia(usedData: unknown) {
    const usedKeys = collectMediaStorageKeys(usedData);
    const unused: string[] = [];
    for (const item of cachedServerMedia()) if (item.kind === "media" && !usedKeys.has(item.key)) unused.push(item.key);
    await deleteStoredMedia(unused);
}

export function clearMediaCaches() {
    objectUrls.forEach((url) => URL.revokeObjectURL(url));
    objectUrls.clear();
    blobs.clear();
}

export function collectMediaStorageKeys(value: unknown, keys = new Set<string>()) {
    if (typeof value === "string" && /^(image|video|audio|file|video-reference|audio-reference):[\w-]+$/.test(value)) keys.add(value);
    if (!value || typeof value !== "object") return keys;
    if ("storageKey" in value && typeof value.storageKey === "string" && value.storageKey.includes(":")) keys.add(value.storageKey);
    Object.values(value).forEach((item) => (Array.isArray(item) ? item.forEach((child) => collectMediaStorageKeys(child, keys)) : collectMediaStorageKeys(item, keys)));
    return keys;
}

export function serializeMediaExport<T>(value: T): T {
    const serialize = (item: unknown): unknown => {
        if (Array.isArray(item)) return item.map(serialize);
        if (!item || typeof item !== "object") return item;
        const next = Object.fromEntries(Object.entries(item).map(([key, child]) => [key, serialize(child)]));
        if (typeof next.storageKey === "string" && next.storageKey.startsWith("image:") && (next.cleared || imageWasCleared(next.storageKey))) {
            for (const field of ["content", "dataUrl", "url"]) if (typeof next[field] === "string") next[field] = "";
            Object.assign(next, { cleared: true, bytes: 0 });
        }
        const data = next.data as Record<string, unknown> | undefined;
        if (next.kind === "image" && data?.cleared) next.coverUrl = "";
        if (typeof next.coverStorageKey === "string" && (next.coverCleared || imageWasCleared(next.coverStorageKey))) Object.assign(next, { coverUrl: "", coverCleared: true });
        return next;
    };
    return serialize(value) as T;
}

export function collectClearedImageKeys(value: unknown, keys = new Set<string>()) {
    if (!value || typeof value !== "object") return keys;
    const item = value as Record<string, unknown>;
    if (item.cleared && typeof item.storageKey === "string") keys.add(item.storageKey);
    if (item.coverCleared && typeof item.coverStorageKey === "string") keys.add(item.coverStorageKey);
    Object.values(item).forEach((child) => collectClearedImageKeys(child, keys));
    return keys;
}

// Explicit ZIP imports create new media; they never overwrite a cleared key.
export async function restoreMediaFiles<T>(value: T, files: Array<{ storageKey: string; path: string; mimeType: string }>, zip: Map<string, Blob>): Promise<T> {
    const signal = serverSessionSignal();
    signal.throwIfAborted();
    const restored = new Map<string, UploadedImage | UploadedFile>();
    await Promise.all([...new Map(files.map((item) => [item.storageKey, item])).values()].map(async (item) => {
        const source = zip.get(item.path);
        if (!source) throw new Error(i18n.t("server.archiveMediaMissing"));
        const blob = source.slice(0, source.size, item.mimeType || source.type);
        const media = item.storageKey.startsWith("image:") ? await uploadImage(blob, { signal }) : await uploadMediaFile(blob, item.storageKey.split(":")[0], { signal });
        if (!media.storageKey) throw new Error(i18n.t("common.imageReadFailed"));
        restored.set(item.storageKey, media);
    }));
    signal.throwIfAborted();
    const remap = (item: unknown): unknown => {
        if (typeof item === "string") return restored.get(item)?.storageKey || item;
        if (Array.isArray(item)) return item.map(remap);
        if (!item || typeof item !== "object") return item;
        const original = item as Record<string, unknown>;
        const next = Object.fromEntries(Object.entries(original).map(([key, child]) => [key, remap(child)]));
        const media = typeof original.storageKey === "string" ? restored.get(original.storageKey) : undefined;
        if (media) {
            for (const field of ["content", "dataUrl", "url"]) if (typeof next[field] === "string") next[field] = media.url;
            next.cleared = false;
            if ("bytes" in next) next.bytes = media.bytes;
        }
        const cover = typeof original.coverStorageKey === "string" ? restored.get(original.coverStorageKey) : undefined;
        if (cover) Object.assign(next, { coverUrl: cover.url, coverCleared: false });
        const data = next.data as Record<string, unknown> | undefined;
        if (next.kind === "image" && !next.coverStorageKey && data?.dataUrl) next.coverUrl = data.dataUrl;
        return next;
    };
    return remap(value) as T;
}

function readVideoMeta(url: string, signal: AbortSignal) {
    return new Promise<{ width: number; height: number; durationMs?: number }>((resolve, reject) => {
        const video = document.createElement("video");
        const cleanup = () => { signal.removeEventListener("abort", abort); video.onloadedmetadata = null; video.onerror = null; video.removeAttribute("src"); };
        const abort = () => { cleanup(); reject(new DOMException("Session ended", "AbortError")); };
        const done = () => { const meta = { width: video.videoWidth || 1280, height: video.videoHeight || 720, durationMs: Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : undefined }; cleanup(); resolve(meta); };
        video.onloadedmetadata = done;
        video.onerror = done;
        if (signal.aborted) return abort();
        signal.addEventListener("abort", abort, { once: true });
        video.preload = "metadata";
        video.src = url;
    });
}

function readAudioMeta(url: string, signal: AbortSignal) {
    return new Promise<{ durationMs?: number }>((resolve, reject) => {
        const audio = document.createElement("audio");
        const cleanup = () => { signal.removeEventListener("abort", abort); audio.onloadedmetadata = null; audio.onerror = null; audio.removeAttribute("src"); };
        const abort = () => { cleanup(); reject(new DOMException("Session ended", "AbortError")); };
        const done = () => { const meta = { durationMs: Number.isFinite(audio.duration) ? Math.round(audio.duration * 1000) : undefined }; cleanup(); resolve(meta); };
        audio.onloadedmetadata = done;
        audio.onerror = done;
        if (signal.aborted) return abort();
        signal.addEventListener("abort", abort, { once: true });
        audio.preload = "metadata";
        audio.src = url;
    });
}
