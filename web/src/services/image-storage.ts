import { nanoid } from "nanoid";
import i18n from "@/i18n";
import { withLocalProxy } from "@/stores/use-config-store";
import { createImageThumbnail } from "@/lib/image-thumbnail";
import { createServerRecordStorage } from "@/lib/server-storage";
import { cachedServerMedia, deleteServerMedia, imageWasCleared, isServerMediaUrl, readServerMediaBlob, readServerMediaUrl, serverMediaInfo, serverMediaUrl, serverSessionEpoch, serverSessionSignal, trackServerTask, writeServerMedia } from "@/services/api/server";
import { reportStorageError } from "@/stores/use-storage-store";

export type UploadedImage = {
    url: string;
    storageKey?: string;
    width: number;
    height: number;
    bytes: number;
    mimeType: string;
};

const imageLogStore = createServerRecordStorage("image_generation_logs");
const videoLogStore = createServerRecordStorage("video_generation_logs");
const objectUrls = new Map<string, string>();
const blobs = new Map<string, Blob>();
const previewUrls = new Map<string, string>();
const previewListeners = new Set<() => void>();
let previewRevision = 0;
let previewQueue: Promise<unknown> = Promise.resolve();
const IMAGE_DOWNLOAD_TIMEOUT_MS = 10 * 60_000;
const IMAGE_DECODE_TIMEOUT_MS = 10_000;
const IMAGE_RESPONSE_ERROR = "ImageResponseError";
const IMAGE_TIMEOUT_ERROR = "ImageTimeoutError";

type ImageReadOptions = { signal?: AbortSignal };

export async function uploadImage(input: string | Blob, options?: ImageReadOptions): Promise<UploadedImage> {
    options = { signal: options?.signal ? AbortSignal.any([options.signal, serverSessionSignal()]) : serverSessionSignal() };
    throwIfAborted(options.signal);
    if (typeof input !== "string") return storeImage(input, options);
    return storeImage(await fetchImageBlob(input, options), options);
}

async function storeImage(blob: Blob, options?: ImageReadOptions): Promise<UploadedImage> {
    const epoch = serverSessionEpoch();
    return trackServerTask(async () => {
        const storageKey = `image:${nanoid()}`;
        const url = URL.createObjectURL(blob);
        try {
            const meta = await loadImageMeta(url, options);
            if (!meta) throw new Error(i18n.t("common.imageReadFailed"));
            throwIfAborted(options?.signal);
            const saved = await writeServerMedia(storageKey, blob, false, options?.signal);
            throwIfAborted(options?.signal);
            objectUrls.set(storageKey, url);
            blobs.set(storageKey, blob.type === saved.mimeType ? blob : blob.slice(0, blob.size, saved.mimeType));
            await storeImagePreview(storageKey, blob);
            throwIfAborted(options?.signal);
            return { url, storageKey, width: meta.width, height: meta.height, bytes: blob.size, mimeType: saved.mimeType };
        } catch (error) {
            URL.revokeObjectURL(url);
            objectUrls.delete(storageKey);
            blobs.delete(storageKey);
            if (epoch === serverSessionEpoch()) await deleteServerMedia(storageKey).catch(() => undefined);
            throw error;
        }
    });
}

async function fetchImageBlob(url: string, options?: ImageReadOptions) {
    if (isServerMediaUrl(url)) return readServerMediaUrl(url, options?.signal);
    const controller = new AbortController();
    let timedOut = false;
    const abort = () => controller.abort();
    if (options?.signal?.aborted) abort();
    else options?.signal?.addEventListener("abort", abort, { once: true });
    const timer = window.setTimeout(() => {
        timedOut = true;
        controller.abort();
    }, IMAGE_DOWNLOAD_TIMEOUT_MS);
    try {
        const response = await fetch(withLocalProxy(url), { signal: controller.signal });
        if (!response.ok) throw namedError(IMAGE_RESPONSE_ERROR);
        return await response.blob();
    } catch (error) {
        if (timedOut) throw namedError(IMAGE_TIMEOUT_ERROR);
        if (options?.signal?.aborted) throw abortReason(options.signal);
        throw error;
    } finally {
        window.clearTimeout(timer);
        options?.signal?.removeEventListener("abort", abort);
    }
}

function loadImageMeta(url: string, options?: ImageReadOptions, timeoutMs = IMAGE_DECODE_TIMEOUT_MS) {
    return new Promise<{ width: number; height: number } | null>((resolve, reject) => {
        if (options?.signal?.aborted) return reject(abortReason(options.signal));
        const image = new Image();
        let settled = false;
        const finish = (value: { width: number; height: number } | null) => {
            if (settled) return;
            settled = true;
            window.clearTimeout(timer);
            options?.signal?.removeEventListener("abort", abort);
            image.onload = null;
            image.onerror = null;
            resolve(value);
        };
        const abort = () => {
            if (settled) return;
            settled = true;
            window.clearTimeout(timer);
            image.onload = null;
            image.onerror = null;
            reject(abortReason(options!.signal!));
        };
        const timer = window.setTimeout(() => finish(null), timeoutMs);
        options?.signal?.addEventListener("abort", abort, { once: true });
        image.onload = () => finish(image.naturalWidth && image.naturalHeight ? { width: image.naturalWidth, height: image.naturalHeight } : null);
        image.onerror = () => finish(null);
        image.src = url;
    });
}

function namedError(name: string) {
    const error = new Error(i18n.t("common.imageReadFailed"));
    error.name = name;
    return error;
}

function abortReason(signal: AbortSignal) {
    return signal.reason instanceof Error ? signal.reason : new DOMException("Aborted", "AbortError");
}

function throwIfAborted(signal?: AbortSignal) {
    if (signal?.aborted) throw abortReason(signal);
}

export async function resolveImageUrl(storageKey?: string, fallback = "") {
    if (!storageKey) return fallback;
    const stored = await serverMediaInfo(storageKey);
    if (!stored || stored.cleared) return "";
    const cached = objectUrls.get(storageKey);
    if (cached) return cached;
    return serverMediaUrl(storageKey);
}

export async function getImageBlob(storageKey: string, signal?: AbortSignal) {
    signal = serverSessionSignal(signal);
    signal.throwIfAborted();
    const stored = await serverMediaInfo(storageKey);
    signal.throwIfAborted();
    if (!stored || stored.cleared) return null;
    return blobs.get(storageKey) || readServerMediaBlob(storageKey, false, signal);
}

// 预览存到服务端，但导出、下载和生成参考仍只使用原文件。
export function previewUrlFor(storageKey?: string) {
    return storageKey && !imageWasCleared(storageKey) ? previewUrls.get(storageKey) : undefined;
}

// 缩略图在后台补，生成完成后再让用到它的界面重渲染一次。
export function subscribeImagePreviews(listener: () => void) {
    previewListeners.add(listener);
    return () => {
        previewListeners.delete(listener);
    };
}

export function getImagePreviewRevision() {
    return previewRevision;
}

export async function ensureImagePreview(storageKey?: string) {
    if (!storageKey) return undefined;
    const signal = serverSessionSignal();
    const stored = await serverMediaInfo(storageKey).catch((error) => { reportStorageError(error); return null; });
    if (signal.aborted || !stored || stored.cleared) return undefined;
    const cached = previewUrls.get(storageKey);
    if (cached) return cached;
    if (stored.previewVersion) return stored.hasPreview ? cacheImagePreview(storageKey) : undefined;
    queueImagePreview(storageKey);
    return undefined;
}

// 缩略图生成排成一队，避免一次打开大量图片时同时解码。
function queueImagePreview(storageKey: string) {
    const epoch = serverSessionEpoch();
    const signal = serverSessionSignal();
    previewQueue = previewQueue
        .then(async () => {
            if (epoch !== serverSessionEpoch()) return;
            const original = await getImageBlob(storageKey, signal);
            signal.throwIfAborted();
            if (original) await storeImagePreview(storageKey, original);
        })
        .catch(() => undefined);
}

async function storeImagePreview(storageKey: string, original: Blob) {
    const epoch = serverSessionEpoch();
    const signal = serverSessionSignal();
    const revision = (await serverMediaInfo(storageKey))?.revision;
    if (signal.aborted) return undefined;
    const preview = await createImageThumbnail(original).catch(() => undefined);
    if (epoch !== serverSessionEpoch() || signal.aborted) return undefined;
    if ((await serverMediaInfo(storageKey))?.revision !== revision) return undefined;
    try {
        await writeServerMedia(storageKey, preview, true, signal);
        if (epoch !== serverSessionEpoch()) return undefined;
        return preview ? cacheImagePreview(storageKey) : undefined;
    } catch (error) { reportStorageError(error); return undefined; }
}

function cacheImagePreview(storageKey: string) {
    const url = serverMediaUrl(storageKey, true);
    previewUrls.set(storageKey, url);
    previewRevision += 1;
    previewListeners.forEach((listener) => listener());
    return url;
}

async function deleteImagePreview(storageKey: string) {
    previewUrls.delete(storageKey);
}

export async function setImageBlob(storageKey: string, blob: Blob) {
    const signal = serverSessionSignal();
    const saved = await writeServerMedia(storageKey, blob, false, signal);
    await deleteImagePreview(storageKey);
    signal.throwIfAborted();
    const url = URL.createObjectURL(blob);
    const previous = objectUrls.get(storageKey);
    if (previous) URL.revokeObjectURL(previous);
    objectUrls.set(storageKey, url);
    blobs.set(storageKey, blob.type === saved.mimeType ? blob : blob.slice(0, blob.size, saved.mimeType));
    await storeImagePreview(storageKey, blob);
    signal.throwIfAborted();
    return url;
}

export async function imageToDataUrl(image: { url?: string; dataUrl?: string; storageKey?: string }, options?: ImageReadOptions) {
    throwIfAborted(options?.signal);
    if (image.storageKey) {
        const blob = await getImageBlob(image.storageKey, options?.signal);
        if (!blob) throw new Error(i18n.t(imageWasCleared(image.storageKey) ? "server.imageCleared" : "common.imageReadFailed"));
        throwIfAborted(options?.signal);
        return blobToDataUrl(blob);
    }
    const url = image.dataUrl || (await resolveImageUrl(image.storageKey, image.url || ""));
    if (!url || url.startsWith("data:")) return url;
    return blobToDataUrl(await fetchImageBlob(url, options));
}

export async function deleteStoredImages(keys: Iterable<string>) {
    await Promise.all(
        Array.from(new Set(keys)).map(async (key) => {
            if (!await deleteServerMedia(key)) return;
            const url = objectUrls.get(key);
            if (url) URL.revokeObjectURL(url);
            objectUrls.delete(key);
            blobs.delete(key);
            await deleteImagePreview(key);
        }),
    );
}

export async function cleanupUnusedImages(usedData: unknown) {
    const signal = serverSessionSignal();
    const usedKeys = collectImageStorageKeys(usedData);
    await Promise.all([
        imageLogStore.iterate((value) => {
            collectImageStorageKeys(value, usedKeys);
        }),
        videoLogStore.iterate((value) => {
            collectImageStorageKeys(value, usedKeys);
        }),
    ]);
    signal.throwIfAborted();
    const unused: string[] = [];
    for (const item of cachedServerMedia()) if (item.kind === "image" && !item.cleared && !usedKeys.has(item.key)) unused.push(item.key);
    await deleteStoredImages(unused);
}

export function clearImageCaches() {
    objectUrls.forEach((url) => URL.revokeObjectURL(url));
    objectUrls.clear();
    blobs.clear();
    previewUrls.clear();
    previewQueue = Promise.resolve();
    previewRevision += 1;
    previewListeners.forEach((listener) => listener());
}

export function collectImageStorageKeys(value: unknown, keys = new Set<string>()) {
    if (typeof value === "string" && /^image:[\w-]+$/.test(value)) keys.add(value);
    if (!value || typeof value !== "object") return keys;
    if ("storageKey" in value && typeof value.storageKey === "string" && value.storageKey.startsWith("image:")) keys.add(value.storageKey);
    Object.values(value).forEach((item) => (Array.isArray(item) ? item.forEach((child) => collectImageStorageKeys(child, keys)) : collectImageStorageKeys(item, keys)));
    return keys;
}

function blobToDataUrl(blob: Blob) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error(i18n.t("common.imageReadFailed")));
        reader.readAsDataURL(blob);
    });
}
