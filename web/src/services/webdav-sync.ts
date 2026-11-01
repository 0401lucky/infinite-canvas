import i18n from "@/i18n";
import { withLocalProxy, type WebdavSyncConfig } from "@/stores/use-config-store";
import { serverSessionSignal } from "@/services/api/server";

export const WEBDAV_MANIFEST_FILE_NAME = "manifest.json";
const WEBDAV_REQUEST_TIMEOUT_MS = 120000;
const ensuredDirectories = new Set<string>();
export const clearWebdavCache = () => ensuredDirectories.clear();
const webdavText = (key: string, options?: Record<string, unknown>) => i18n.t(`config.webdav.errors.${key}`, options);

export async function testWebdavConnection(config: WebdavSyncConfig) {
    const signal = serverSessionSignal();
    await ensureWebdavDirectory(config, signal);
    const response = await webdavFetch(config, "", { method: "PROPFIND", headers: { Depth: "0" }, signal });
    if (response.ok || response.status === 207) return;
    await throwWebdavError(response, webdavText("testFailed"));
}

export async function downloadWebdavSyncFile(config: WebdavSyncConfig) {
    return downloadWebdavFile(config, WEBDAV_MANIFEST_FILE_NAME);
}

export async function downloadWebdavFile(config: WebdavSyncConfig, path: string, signal = serverSessionSignal()) {
    await ensureWebdavDirectory(config, signal);
    const response = await webdavFetch(config, path, { method: "GET", signal });
    if (response.status === 404) return null;
    if (!response.ok) await throwWebdavError(response, webdavText("downloadFailed"));
    const file = await withTimeout(response.blob(), webdavText("downloadTimeout"));
    return file.size ? file : null;
}

export async function uploadWebdavSyncFile(config: WebdavSyncConfig, file: Blob) {
    return uploadWebdavFile(config, WEBDAV_MANIFEST_FILE_NAME, file, "application/json");
}

export async function uploadWebdavFile(config: WebdavSyncConfig, path: string, file: Blob, contentType = "application/octet-stream", signal = serverSessionSignal()) {
    if (!file.size) throw new Error(webdavText("emptyUpload"));
    await ensureWebdavDirectory(config, signal);
    await ensureWebdavSubdirectory(config, path, signal);
    const response = await webdavFetch(config, path, {
        method: "PUT",
        headers: { "Content-Type": contentType },
        body: file,
        signal,
    });
    if (!response.ok) await throwWebdavError(response, webdavText("uploadFailed"));
}

async function ensureWebdavDirectory(config: WebdavSyncConfig, signal: AbortSignal) {
    assertWebdavConfig(config);
    await ensureWebdavDirectoryPath(config, config.directory, signal);
}

async function ensureWebdavSubdirectory(config: WebdavSyncConfig, path: string, signal: AbortSignal) {
    const directory = normalizePath(path).split("/").slice(0, -1).join("/");
    if (!directory) return;
    await ensureWebdavDirectoryPath(config, [config.directory, directory].filter(Boolean).join("/"), signal);
}

async function ensureWebdavDirectoryPath(config: WebdavSyncConfig, directory: string, signal: AbortSignal) {
    signal.throwIfAborted();
    const parts = normalizePath(directory).split("/").filter(Boolean);
    const cacheKey = `${config.url}:${parts.join("/")}`;
    if (ensuredDirectories.has(cacheKey)) return;
    let path = "";
    for (const part of parts) {
        path = path ? `${path}/${part}` : part;
        const response = await webdavFetch({ ...config, directory: "" }, path, { method: "MKCOL", signal });
        if (response.ok || ((response.status === 405 || response.status === 423) && (await webdavDirectoryExists(config, path, signal)))) continue;
        await throwWebdavError(response, webdavText("directoryFailed"));
    }
    signal.throwIfAborted();
    ensuredDirectories.add(cacheKey);
}

async function webdavDirectoryExists(config: WebdavSyncConfig, path: string, signal: AbortSignal) {
    const response = await webdavFetch({ ...config, directory: "" }, path, { method: "PROPFIND", headers: { Depth: "0" }, signal });
    return response.ok || response.status === 207;
}

async function webdavFetch(config: WebdavSyncConfig, path: string, init: RequestInit) {
    const signal = serverSessionSignal(init.signal || undefined);
    signal.throwIfAborted();
    const headers = new Headers(init.headers);
    if (config.username || config.password) headers.set("Authorization", `Basic ${encodeBasicAuth(`${config.username}:${config.password}`)}`);
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), WEBDAV_REQUEST_TIMEOUT_MS);
    try {
        const url = withLocalProxy(buildWebdavUrl(config, path));
        return await fetch(url, { ...init, headers, signal: AbortSignal.any([controller.signal, signal]) });
    } catch (error) {
        if (signal.aborted) throw new DOMException("Session ended", "AbortError");
        if (error instanceof Error && error.name === "AbortError") throw new Error(webdavText("requestTimeout"));
        if (error instanceof TypeError) throw new Error(webdavText("connectionFailed"));
        throw error;
    } finally {
        window.clearTimeout(timer);
    }
}

function buildWebdavUrl(config: WebdavSyncConfig, path: string) {
    const baseUrl = config.url.trim().replace(/\/+$/, "");
    const remotePath = [normalizePath(config.directory), normalizePath(path)].filter(Boolean).join("/");
    if (!remotePath) return baseUrl;
    return `${baseUrl}/${remotePath.split("/").map(encodeURIComponent).join("/")}`;
}

function normalizePath(path: string) {
    return path.trim().replace(/^\/+|\/+$/g, "");
}

function assertWebdavConfig(config: WebdavSyncConfig) {
    if (!config.url.trim()) throw new Error(webdavText("urlRequired"));
}

async function throwWebdavError(response: Response, fallback: string): Promise<never> {
    const detail = await response.text().catch(() => "");
    if (response.status === 401 || response.status === 403) throw new Error(webdavText("authenticationFailed"));
    if (response.status === 404) throw new Error(webdavText("pathMissing"));
    throw new Error(webdavText("responseFailed", { fallback, status: response.status, detail: detail ? ` ${detail.slice(0, 120)}` : "" }));
}

function encodeBasicAuth(value: string) {
    const bytes = new TextEncoder().encode(value);
    let binary = "";
    bytes.forEach((byte) => {
        binary += String.fromCharCode(byte);
    });
    return btoa(binary);
}

function withTimeout<T>(promise: Promise<T>, message: string) {
    return new Promise<T>((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error(message)), WEBDAV_REQUEST_TIMEOUT_MS);
        promise.then(resolve, reject).finally(() => window.clearTimeout(timer));
    });
}
