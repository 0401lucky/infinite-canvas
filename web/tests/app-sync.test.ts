import { afterAll, afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import type { CanvasProject } from "../src/stores/canvas/use-canvas-store";
import type { Asset, TextAsset } from "../src/stores/use-asset-store";
import type { AppSyncDomainKey } from "../src/services/app-sync";
import type { CanvasNodeData } from "../src/types/canvas";

const originals = new Map(["localStorage", "window"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined } });
Object.defineProperty(globalThis, "window", { configurable: true, value: globalThis });
afterAll(() => {
    for (const [key, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
    }
});

const { syncAppDataToWebdav } = await import("../src/services/app-sync");
const { createServerRecordStorage } = await import("../src/lib/server-storage");
const { allowServerWrites, resetServerSession } = await import("../src/services/api/server");
const { discardCanvasSave, useCanvasStore } = await import("../src/stores/canvas/use-canvas-store");
const { useAssetStore } = await import("../src/stores/use-asset-store");
const { useConfigStore } = await import("../src/stores/use-config-store");
const { useUserStore } = await import("../src/stores/use-user-store");
const { useStorageStore } = await import("../src/stores/use-storage-store");
const { clearImageCaches } = await import("../src/services/image-storage");
const { clearMediaCaches } = await import("../src/services/file-storage");
const { clearWebdavCache } = await import("../src/services/webdav-sync");
const { CanvasNodeType } = await import("../src/types/canvas");

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((next) => { resolve = next; });
    return { promise, resolve };
}
const oldTime = "2000-01-01T00:00:00.000Z";
const remoteTime = "2000-01-02T00:00:00.000Z";
const config = { url: "https://webdav.example", username: "", password: "", directory: "", lastSyncedAt: "" };
const mediaBlob = new Blob(["video fixture"], { type: "video/mp4" });
const node = (id: string, type = CanvasNodeType.Text, storageKey?: string): CanvasNodeData => ({ id, type, title: id, width: 160, height: 90, position: { x: 0, y: 0 }, metadata: { content: "", storageKey } });
const project = (id: string, nodes: CanvasNodeData[] = []): CanvasProject => ({ id, title: id, createdAt: oldTime, updatedAt: oldTime, nodes, connections: [], chatSessions: [], activeChatId: null, backgroundMode: "lines", showImageInfo: false, viewport: { x: 0, y: 0, k: 1 } });
const asset = (id: string): TextAsset => ({ id, kind: "text", title: id, createdAt: oldTime, updatedAt: oldTime, tags: [], coverUrl: "", data: { content: "initial" } });
type Stored = { key: string; value: unknown; revision: number };
type SyncFile = { storageKey: string; path: string; mimeType: string; bytes: number };
type Remote = { data: unknown; files?: SyncFile[] };
type Uploaded = { data: { projects?: CanvasProject[]; deleted?: Array<{ id: string }>; assets?: Asset[] } };
let remote = new Map<AppSyncDomainKey, Remote>();
let uploaded = new Map<AppSyncDomainKey, Uploaded>();
let records = new Map<string, Map<string, Stored>>();
let revisions = new Map<string, number>();
let savedMedia = new Map<string, number>();
let existingImages = new Set<string>();
let clearedImages = new Set<string>();
let collectionWrites: Array<{ namespace: string; revision: number }> = [];
let manifestWrites = 0;
let mediaWrites = 0;
let mediaDownloads = 0;
let missingReads = 0;
let holdDownloads = false;
let downloadStarted = deferred<void>();
let downloadRelease = deferred<void>();
let scansReady = deferred<void>();
let runs: Array<Promise<unknown>> = [];
const json = (data: unknown) => new Response(JSON.stringify({ data }), { headers: { "Content-Type": "application/json" } });
const conflict = () => new Response(JSON.stringify({ error: { code: "STORAGE_CONFLICT", message: "Version conflict" } }), { status: 409 });
function mediaInfo(key: string) {
    if (!savedMedia.has(key) && !existingImages.has(key) && !clearedImages.has(key)) return null;
    return { key, kind: key.startsWith("image:") ? "image" : "media", mimeType: key.startsWith("image:") ? "image/png" : "video/mp4", bytes: mediaBlob.size, previewBytes: 0, previewVersion: 1, hasPreview: false, revision: savedMedia.get(key) || 1, cleared: clearedImages.has(key) };
}
function seed(projects: CanvasProject[], assets: Asset[]) {
    allowServerWrites(false);
    discardCanvasSave();
    useCanvasStore.setState({ projects, deletedProjects: [], hydrated: true });
    useAssetStore.setState({ assets, hydrated: true });
    allowServerWrites(true);
}
function startSync() {
    const run = syncAppDataToWebdav(config);
    runs.push(run);
    void run.catch(() => undefined);
    return run;
}

beforeEach(() => {
    remote = new Map(); uploaded = new Map(); records = new Map(); revisions = new Map(); savedMedia = new Map();
    existingImages = new Set(); clearedImages = new Set(); collectionWrites = []; runs = [];
    manifestWrites = 0; mediaWrites = 0; mediaDownloads = 0; missingReads = 0; holdDownloads = false;
    downloadStarted = deferred<void>(); downloadRelease = deferred<void>(); scansReady = deferred<void>();
    resetServerSession("test-user");
    clearImageCaches(); clearMediaCaches(); clearWebdavCache();
    useConfigStore.setState(useConfigStore.getInitialState(), true);
    useUserStore.setState({ user: { id: "test-user", username: "tester", role: "admin" }, status: "authenticated", ready: true, loading: false, dataEpoch: 11 });
    seed([], []);
    spyOn(useUserStore.getState(), "reloadData").mockResolvedValue(undefined);
    spyOn(globalThis, "fetch").mockImplementation(async (input, init = {}) => {
        const url = new URL(String(input), "http://localhost");
        const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
        const method = init.method || "GET";
        const expected = Number(new Headers(init.headers).get("If-Match"));
        if (parts[0] === "api" && parts[1] === "records") {
            const namespace = parts[2];
            const key = parts[3];
            const current = records.get(namespace) || new Map<string, Stored>();
            records.set(namespace, current);
            const revision = revisions.get(namespace) || 0;
            if (method === "GET") return json(key ? current.get(key) || { key, value: null, revision: 0 } : { revision, records: [...current.values()] });
            const body = JSON.parse(String(init.body));
            if (!key) {
                collectionWrites.push({ namespace, revision: expected });
                if (expected !== revision) return conflict();
                const items = body.records as Array<{ key: string; value: unknown }>;
                const next = new Map(items.map((item) => [item.key, { ...item, revision: (current.get(item.key)?.revision || 0) + 1 }]));
                records.set(namespace, next);
                revisions.set(namespace, revision + items.length);
                return json({ revision: revisions.get(namespace), records: [...next.values()] });
            }
            if (expected !== (current.get(key)?.revision || 0)) return conflict();
            const value = { key, value: body.value, revision: expected + 1 };
            current.set(key, value);
            revisions.set(namespace, revision + 1);
            return json(value);
        }
        if (parts[0] === "api" && parts[1] === "media") {
            const key = parts[2];
            if (method === "GET" && parts[3] === "original") {
                if (mediaInfo(key)) return new Response(key.startsWith("image:") ? new Blob(["image fixture"], { type: "image/png" }) : mediaBlob);
                missingReads += 1;
                if (missingReads === 2) scansReady.resolve(undefined);
                return new Response(null, { status: 404 });
            }
            if (method === "GET") return json(mediaInfo(key));
            if (expected !== (mediaInfo(key)?.revision || 0)) return conflict();
            mediaWrites += 1;
            savedMedia.set(key, expected + 1);
            return json(mediaInfo(key));
        }
        const domain = parts[0] as AppSyncDomainKey;
        if (method === "MKCOL") return new Response(null, { status: 201 });
        if (method === "GET" && parts.at(-1) === "manifest.json") {
            const empty = domain === "canvas" ? { projects: [], deleted: [] } : domain === "assets" ? { assets: [] } : { logs: [] };
            const source = remote.get(domain) || { data: empty };
            return new Response(JSON.stringify({ app: "infinite-canvas", version: 1, domain, exportedAt: remoteTime, data: source.data, files: source.files || [] }));
        }
        if (method === "GET") {
            mediaDownloads += 1;
            downloadStarted.resolve(undefined);
            if (holdDownloads) await downloadRelease.promise;
            return new Response(mediaBlob);
        }
        if (method === "PUT") {
            if (parts.at(-1) === "manifest.json") {
                manifestWrites += 1;
                uploaded.set(domain, JSON.parse(await (init.body as Blob).text()));
            }
            return new Response(null, { status: 201 });
        }
        throw new Error(`Unexpected test request: ${method} ${url.pathname}`);
    });
});
afterEach(async () => {
    resetServerSession();
    downloadRelease.resolve(undefined);
    await Promise.allSettled(runs);
    await new Promise<void>((resolve) => setImmediate(resolve));
    discardCanvasSave(); clearImageCaches(); clearMediaCaches(); clearWebdavCache();
    useUserStore.setState(useUserStore.getInitialState(), true);
    mock.restore();
});

test("sync preserves edits made during downloads, deduplicates shared media and never reloads the page", async () => {
    seed([project("edited", [node("text")]), project("deleted")], [asset("edited-asset")]);
    const key = "video:shared";
    const file = { storageKey: key, path: "canvas/files/shared.mp4", mimeType: mediaBlob.type, bytes: mediaBlob.size };
    remote.set("canvas", { data: { projects: [{ ...project("edited", [node("video", CanvasNodeType.Video, key)]), updatedAt: remoteTime }, project("deleted"), project("imported")], deleted: [] }, files: [file] });
    const videoAsset: Asset = { ...asset("imported-video"), kind: "video", data: { url: "", storageKey: key, width: 160, height: 90, bytes: mediaBlob.size, mimeType: mediaBlob.type } };
    remote.set("assets", { data: { assets: [{ ...asset("edited-asset"), updatedAt: remoteTime }, videoAsset] }, files: [{ ...file, path: "assets/files/shared.mp4" }] });
    holdDownloads = true;
    const run = startSync();
    await Promise.all([downloadStarted.promise, scansReady.promise]);
    useCanvasStore.getState().renameProject("edited", "latest title");
    useCanvasStore.getState().updateProject("edited", { nodes: [{ ...node("text"), metadata: { content: "latest text" } }] });
    useCanvasStore.getState().deleteProjects(["deleted"]);
    const created = useCanvasStore.getState().createProject("created during sync");
    useAssetStore.getState().updateAsset("edited-asset", { title: "latest asset", data: { content: "latest content" } });
    const added = useAssetStore.getState().addAsset({ kind: "text", title: "created during sync", coverUrl: "", tags: [], data: { content: "new" } });
    downloadRelease.resolve(undefined);
    await run;

    const projects = useCanvasStore.getState().projects;
    expect(projects.find((item) => item.id === "edited")?.nodes[0].metadata?.content).toBe("latest text");
    expect(projects.map((item) => item.id).sort()).toEqual(["edited", "imported", created].sort());
    expect(useCanvasStore.getState().deletedProjects.some((item) => item.id === "deleted")).toBe(true);
    expect(useAssetStore.getState().assets.find((item) => item.id === "edited-asset")?.title).toBe("latest asset");
    expect(useAssetStore.getState().assets.some((item) => item.id === added)).toBe(true);
    expect(uploaded.get("canvas")?.data.projects?.find((item) => item.id === "edited")?.title).toBe("latest title");
    expect(uploaded.get("canvas")?.data.deleted?.some((item) => item.id === "deleted")).toBe(true);
    expect(uploaded.get("assets")?.data.assets?.find((item) => item.id === "edited-asset")?.title).toBe("latest asset");
    expect(mediaDownloads).toBe(1);
    expect(mediaWrites).toBe(1);
    expect(useUserStore.getState().reloadData).not.toHaveBeenCalled();
    expect(useUserStore.getState().dataEpoch).toBe(11);
});

test("in-place sync restores blank image URLs, assistant references and custom covers without reviving cleared keys", async () => {
    const key = "image:existing";
    const cleared = "image:cleared";
    existingImages.add(key);
    clearedImages.add(cleared);
    const imported = project("images", [node("image", CanvasNodeType.Image, key), { ...node("cleared", CanvasNodeType.Image, cleared), metadata: { storageKey: cleared, cleared: true, content: "https://old.example/image.png" } }]);
    imported.chatSessions = [{ id: "chat", title: "chat", createdAt: oldTime, updatedAt: oldTime, messages: [{ id: "message", role: "user", title: "message", text: "reference", references: [{ id: "ref", type: CanvasNodeType.Image, title: "ref", storageKey: key, dataUrl: "" }] }] }];
    remote.set("canvas", { data: { projects: [imported], deleted: [] }, files: [{ storageKey: cleared, path: "canvas/files/cleared.png", mimeType: "image/png", bytes: 1 }] });
    remote.set("assets", { data: { assets: [{ ...asset("cover"), coverStorageKey: key }] } });
    await startSync();

    const restored = useCanvasStore.getState().projects[0];
    expect(restored.nodes[0].metadata?.content).toContain("/api/media/image%3Aexisting/original");
    expect(restored.chatSessions[0].messages[0].references?.[0].dataUrl).toBe(restored.nodes[0].metadata?.content);
    expect(restored.nodes[1].metadata?.content).toBe("");
    expect(restored.nodes[1].metadata?.cleared).toBe(true);
    expect(useAssetStore.getState().assets[0].coverUrl).toBe(restored.nodes[0].metadata?.content);
    expect(mediaDownloads).toBe(0);
    expect(mediaWrites).toBe(0);
});

test("a history changed during sync keeps its new record and rejects the original stale snapshot", async () => {
    remote.set("video-workbench", { data: { logs: [{ id: "remote-log", createdAt: 1, video: { storageKey: "video:shared", url: "" } }] }, files: [{ storageKey: "video:shared", path: "video-workbench/files/shared.mp4", mimeType: mediaBlob.type, bytes: mediaBlob.size }] });
    holdDownloads = true;
    const run = startSync();
    await downloadStarted.promise;
    const log = { id: "new-log", createdAt: 2, status: "success" };
    await createServerRecordStorage("video_generation_logs").setItem(log.id, log);
    downloadRelease.resolve(undefined);
    await expect(run).rejects.toMatchObject({ code: "STORAGE_CONFLICT" });

    expect(records.get("video_generation_logs")?.get(log.id)?.value).toEqual(log);
    expect(records.get("video_generation_logs")?.has("remote-log")).toBe(false);
    expect(collectionWrites.filter((item) => item.namespace === "video_generation_logs")).toEqual([{ namespace: "video_generation_logs", revision: 0 }]);
    expect(useStorageStore.getState().failedWrites["video_generation_logs/"]).toBeTruthy();
    expect(useUserStore.getState().reloadData).not.toHaveBeenCalled();
});

test("a cancelled sync cannot apply old data or upload into a new session", async () => {
    remote.set("canvas", { data: { projects: [project("old", [node("video", CanvasNodeType.Video, "video:shared")])], deleted: [] }, files: [{ storageKey: "video:shared", path: "canvas/files/shared.mp4", mimeType: mediaBlob.type, bytes: mediaBlob.size }] });
    holdDownloads = true;
    const run = startSync();
    await downloadStarted.promise;
    resetServerSession("next-user");
    seed([project("next-user-project")], []);
    const writesBefore = manifestWrites;
    downloadRelease.resolve(undefined);
    await expect(run).rejects.toMatchObject({ name: "AbortError" });

    expect(useCanvasStore.getState().projects.map((item) => item.id)).toEqual(["next-user-project"]);
    expect(manifestWrites).toBe(writesBefore);
    expect(mediaWrites).toBe(0);
});
