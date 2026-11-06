import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { config } from "./config.js";

export class ApiError extends Error {
    constructor(public status: number, public code: string, message: string) {
        super(message);
    }
}

type RecordRow = { key: string; value: string | null; revision: number };
export type MediaRow = {
    key: string; kind: "image" | "media"; path: string | null; preview_path: string | null; mime_type: string;
    bytes: number; preview_bytes: number; preview_version: number; revision: number; status: "active" | "clearing" | "cleared";
};

export function mediaInfo(row: MediaRow) {
    return { key: row.key, kind: row.kind, mimeType: row.mime_type, bytes: row.bytes, previewBytes: row.preview_bytes, previewVersion: row.preview_version, hasPreview: Boolean(row.preview_path), revision: row.revision, cleared: row.status !== "active" };
}

function openStorage(dataDir: string) {
    const imageDir = resolve(dataDir, "media/images");
    const mediaDir = resolve(dataDir, "media/files");
    const previewDir = resolve(dataDir, "previews");
    const uploadDir = resolve(dataDir, "uploads");
    for (const dir of [dataDir, imageDir, mediaDir, previewDir, uploadDir]) mkdirSync(dir, { recursive: true });
    const db = new Database(resolve(dataDir, "app.sqlite"));
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.exec(`
        CREATE TABLE IF NOT EXISTS store_revisions (namespace TEXT PRIMARY KEY, revision INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE IF NOT EXISTS records (
            namespace TEXT NOT NULL, key TEXT NOT NULL, value TEXT, revision INTEGER NOT NULL,
            PRIMARY KEY (namespace, key)
        );
        CREATE TABLE IF NOT EXISTS media (
            key TEXT PRIMARY KEY, kind TEXT NOT NULL, path TEXT, preview_path TEXT, mime_type TEXT NOT NULL,
            bytes INTEGER NOT NULL DEFAULT 0, preview_bytes INTEGER NOT NULL DEFAULT 0,
            preview_version INTEGER NOT NULL DEFAULT 0, revision INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'active'
        );
    `);

    function mediaRow(key: string) {
        return db.prepare("SELECT * FROM media WHERE key = ?").get(key) as MediaRow | undefined;
    }

    function clearedKeys() {
        return new Set((db.prepare("SELECT key FROM media WHERE kind = 'image' AND status != 'active'").all() as Array<{ key: string }>).map((row) => row.key));
    }

    // Canonical records never keep temporary object URLs or revive cleared images.
    function normalizeMedia(value: unknown, cleared = clearedKeys()): unknown {
        if (Array.isArray(value)) return value.map((item) => normalizeMedia(item, cleared));
        if (!value || typeof value !== "object") return value;
        const next: Record<string, unknown> = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalizeMedia(item, cleared)]));
        const storageKey = typeof next.storageKey === "string" ? next.storageKey : "";
        if (storageKey) {
            for (const field of ["content", "dataUrl", "url"]) {
                if (typeof next[field] === "string" && (cleared.has(storageKey) || next[field].startsWith("blob:"))) next[field] = "";
            }
            if (cleared.has(storageKey)) Object.assign(next, { cleared: true, bytes: 0 });
        }
        const data = next.data as Record<string, unknown> | undefined;
        if (next.kind === "image" && data?.storageKey && (data.cleared || (typeof next.coverUrl === "string" && next.coverUrl.startsWith("blob:")))) next.coverUrl = "";
        if (typeof next.coverStorageKey === "string") {
            if (cleared.has(next.coverStorageKey)) Object.assign(next, { coverUrl: "", coverCleared: true });
            else if (typeof next.coverUrl === "string" && next.coverUrl.startsWith("blob:")) next.coverUrl = "";
        }
        return next;
    }

    function storeRevision(namespace: string) {
        return (db.prepare("SELECT revision FROM store_revisions WHERE namespace = ?").get(namespace) as { revision: number } | undefined)?.revision ?? 0;
    }

    function bumpStore(namespace: string) {
        db.prepare("INSERT INTO store_revisions VALUES (?, 1) ON CONFLICT(namespace) DO UPDATE SET revision = revision + 1").run(namespace);
    }

    function requireRevision(actual: number, expected: number) {
        if (actual !== expected) throw new ApiError(409, "STORAGE_CONFLICT", "保存版本发生冲突，本次修改未保存。请先保留当前内容，再决定是否重新加载");
    }

    function readRecord(namespace: string, key: string) {
        const row = db.prepare("SELECT key, value, revision FROM records WHERE namespace = ? AND key = ?").get(namespace, key) as RecordRow | undefined;
        return { key, value: row?.value == null ? null : JSON.parse(row.value) as unknown, revision: row?.revision ?? 0 };
    }

    function readRecords(namespace: string) {
        const rows = db.prepare("SELECT key, value, revision FROM records WHERE namespace = ?").all(namespace) as RecordRow[];
        return { revision: storeRevision(namespace), records: rows.map((row) => ({ key: row.key, value: row.value == null ? null : JSON.parse(row.value) as unknown, revision: row.revision, deleted: row.value == null })) };
    }

    function writeRecord(namespace: string, key: string, value: unknown, deleted = false) {
        const current = readRecord(namespace, key);
        const json = deleted ? null : JSON.stringify(normalizeMedia(value));
        if (json === undefined) throw new ApiError(400, "INVALID_REQUEST", "数据必须是有效 JSON");
        db.prepare("INSERT INTO records VALUES (?, ?, ?, ?) ON CONFLICT(namespace, key) DO UPDATE SET value = excluded.value, revision = excluded.revision").run(namespace, key, json, current.revision + 1);
        bumpStore(namespace);
        return readRecord(namespace, key);
    }

    const saveRecord = db.transaction((namespace: string, key: string, value: unknown, expected: number, deleted = false) => {
        requireRevision(readRecord(namespace, key).revision, expected);
        return writeRecord(namespace, key, value, deleted);
    });

    const replaceRecords = db.transaction((namespace: string, items: Array<{ key: string; value: unknown }>, expected: number) => {
        requireRevision(storeRevision(namespace), expected);
        const incoming = new Map(items.map((item) => [item.key, item.value]));
        for (const row of readRecords(namespace).records) if (!row.deleted && !incoming.has(row.key)) writeRecord(namespace, row.key, null, true);
        for (const [key, value] of incoming) writeRecord(namespace, key, value);
        return readRecords(namespace);
    });

    function mediaIsReferenced(key: string) {
        const contains = (value: unknown): boolean => value === key || Boolean(value && typeof value === "object" && Object.values(value).some(contains));
        return (db.prepare("SELECT value FROM records WHERE value IS NOT NULL").all() as Array<{ value: string }>).some((row) => contains(JSON.parse(row.value)));
    }

    const beginImageCleanup = db.transaction(() => {
        db.prepare("UPDATE media SET status = 'clearing', revision = revision + 1 WHERE kind = 'image' AND status = 'active'").run();
        const cleared = clearedKeys();
        for (const row of db.prepare("SELECT namespace, key, value FROM records WHERE value IS NOT NULL").all() as Array<{ namespace: string; key: string; value: string }>) {
            const value = normalizeMedia(JSON.parse(row.value), cleared);
            if (JSON.stringify(value) !== row.value) writeRecord(row.namespace, row.key, value);
        }
        return db.prepare("SELECT * FROM media WHERE kind = 'image' AND status = 'clearing'").all() as MediaRow[];
    });

    return { db, dataDir, imageDir, mediaDir, previewDir, uploadDir, mediaRow, readRecord, readRecords, saveRecord, replaceRecords, mediaIsReferenced, beginImageCleanup };
}

export type UserStorage = ReturnType<typeof openStorage>;
export const adminStorage = openStorage(config.dataDir);
export const db = adminStorage.db;
db.exec(`
    CREATE TABLE IF NOT EXISTS admin (id INTEGER PRIMARY KEY CHECK (id = 1), username TEXT NOT NULL, password_hash TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS members (
        id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
        disabled INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS member_sessions (
        token_hash TEXT PRIMARY KEY, member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
        expires_at INTEGER NOT NULL
    );
`);

const userStores = new Map<string, UserStorage>([["1", adminStorage]]);
// IDs come only from authenticated accounts, never usernames or request parameters.
export function storageForUser(id: string) {
    let storage = userStores.get(id);
    if (!storage) {
        storage = openStorage(resolve(config.dataDir, "users", id));
        userStores.set(id, storage);
    }
    return storage;
}
