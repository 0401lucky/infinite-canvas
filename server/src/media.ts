import { randomUUID } from "node:crypto";
import { unlinkSync } from "node:fs";
import { readdir, rename, stat, unlink } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve } from "node:path";
import express, { type Request } from "express";
import multer from "multer";
import { z } from "zod";

import { config, imageDir, mediaDir, previewDir, uploadDir } from "./config.js";
import { validSession } from "./auth.js";
import { ApiError, beginImageCleanup, db, mediaInfo, mediaIsReferenced, mediaRow, type MediaRow } from "./storage.js";

const upload = multer({ storage: multer.diskStorage({ destination: uploadDir, filename: (_req, _file, done) => done(null, randomUUID()) }), limits: { fileSize: config.uploadBytes } }).single("file");
const keySchema = z.string().regex(/^(image|video|audio|file|video-reference|audio-reference):[\w-]+$/);
const expectedRevision = (req: Request) => z.coerce.number().int().nonnegative().parse(req.get("if-match"));
const keyOf = (req: Request) => keySchema.parse(req.params.key);
const pendingFiles = new Set<string>();

function ownedPath(path: string) {
    const absolute = resolve(config.dataDir, path);
    const inside = relative(config.dataDir, absolute);
    if (isAbsolute(inside) || inside.startsWith("..") || inside === "") throw new ApiError(500, "INVALID_MEDIA_PATH", "媒体路径无效");
    return absolute;
}

async function removeFile(path: string) {
    try { await unlink(ownedPath(path)); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
}

function requireWritable(key: string, expected: number) {
    const row = mediaRow(key);
    if (row && row.status !== "active") throw new ApiError(410, "MEDIA_CLEARED", "图片已清理，请重新上传");
    if ((row?.revision ?? 0) !== expected) throw new ApiError(409, "STORAGE_CONFLICT", "媒体已更新，请重新加载");
    return row;
}

async function directoryFiles(dir: string) {
    return (await readdir(dir, { withFileTypes: true })).filter((item) => item.isFile()).map((item) => relative(config.dataDir, resolve(dir, item.name)));
}

async function totalBytes(paths: string[]) {
    const sizes = await Promise.all(paths.map(async (path) => {
        try { return (await stat(ownedPath(path))).size; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0; throw error; }
    }));
    return sizes.reduce((sum, size) => sum + size, 0);
}

export async function storageUsage() {
    const [images, previews, files, databaseFiles, uploads] = await Promise.all([
        directoryFiles(imageDir), directoryFiles(previewDir), directoryFiles(mediaDir),
        directoryFiles(config.dataDir).then((items) => items.filter((path) => basename(path).startsWith("app.sqlite"))),
        directoryFiles(uploadDir),
    ]);
    const [imageBytes, previewBytes, mediaBytes, databaseBytes, uploadBytes] = await Promise.all([images, previews, files, databaseFiles, uploads].map(totalBytes));
    return { images: images.length, previews: previews.length, imageBytes, previewBytes, mediaBytes, databaseBytes, uploadBytes, totalBytes: imageBytes + previewBytes + mediaBytes + databaseBytes + uploadBytes };
}

export async function clearImages() {
    const files = [...await directoryFiles(imageDir), ...await directoryFiles(previewDir)];
    const rows = beginImageCleanup();
    // Include orphaned image/preview files, but never recurse into the data root.
    const paths = new Set([...files.filter((path) => !pendingFiles.has(path)), ...rows.flatMap((row) => [row.path, row.preview_path].filter((path): path is string => Boolean(path)))]);
    let failed = false;
    for (const path of paths) {
        try { await removeFile(path); } catch { failed = true; }
    }
    for (const row of rows) {
        const originalExists = row.path && await stat(ownedPath(row.path)).then(() => true, (error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return false; throw error; });
        const previewExists = row.preview_path && await stat(ownedPath(row.preview_path)).then(() => true, (error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return false; throw error; });
        db.prepare("UPDATE media SET path = ?, bytes = ?, preview_path = ?, preview_bytes = ?, status = ?, revision = revision + 1 WHERE key = ?").run(originalExists ? row.path : null, originalExists ? row.bytes : 0, previewExists ? row.preview_path : null, previewExists ? row.preview_bytes : 0, originalExists || previewExists ? "clearing" : "cleared", row.key);
    }
    if (failed) throw new ApiError(500, "IMAGE_CLEANUP_FAILED", "部分图片未清理完成，请再次清理");
    return storageUsage();
}

export const mediaRouter = express.Router();
mediaRouter.get("/", (_req, res) => res.json({ data: (db.prepare("SELECT * FROM media").all() as MediaRow[]).map(mediaInfo) }));
mediaRouter.get("/:key", (req, res) => {
    const row = mediaRow(keyOf(req));
    res.json({ data: row ? mediaInfo(row) : null });
});

for (const preview of [false, true]) {
    mediaRouter.put(preview ? "/:key/preview" : "/:key", (req, res, next) => {
        const key = keyOf(req);
        const revision = expectedRevision(req);
        requireWritable(key, revision);
        upload(req, res, (error) => {
            if (error) return next(error);
            void (async () => {
                const file = req.file;
                let destination: string | null = null;
                let committed = false;
                try {
                    const current = requireWritable(key, revision);
                    if (!preview && !file) throw new ApiError(400, "INVALID_REQUEST", "没有上传文件");
                    if (preview && (!current || current.kind !== "image")) throw new ApiError(404, "MEDIA_NOT_FOUND", "图片不存在");
                    if (file) {
                        destination = relative(config.dataDir, resolve(preview ? previewDir : key.startsWith("image:") ? imageDir : mediaDir, `${randomUUID()}.bin`));
                        pendingFiles.add(destination);
                        await rename(file.path, ownedPath(destination));
                    }
                    if (req.aborted || res.destroyed) throw new ApiError(400, "UPLOAD_ABORTED", "上传已取消");
                    if (!validSession(req.cookies)) throw new ApiError(401, "UNAUTHORIZED", "请重新登录");
                    requireWritable(key, revision);
                    if (preview) {
                        db.prepare("UPDATE media SET preview_path = ?, preview_bytes = ?, preview_version = 1, revision = revision + 1 WHERE key = ?").run(destination, file?.size ?? 0, key);
                    } else {
                        db.prepare("INSERT INTO media (key, kind, path, mime_type, bytes, revision) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET path = excluded.path, mime_type = excluded.mime_type, bytes = excluded.bytes, preview_path = NULL, preview_bytes = 0, preview_version = 0, revision = excluded.revision").run(key, key.startsWith("image:") ? "image" : "media", destination, file!.mimetype || "application/octet-stream", file!.size, revision + 1);
                    }
                    committed = true;
                    if (destination) pendingFiles.delete(destination);
                    const obsolete = preview ? [current?.preview_path] : [current?.path, current?.preview_path];
                    for (const path of obsolete) if (path) await removeFile(path).catch(() => console.warn("Obsolete media file remains in storage"));
                    res.json({ data: mediaInfo(mediaRow(key)!) });
                } finally {
                    if (destination) pendingFiles.delete(destination);
                    if (file) await unlink(file.path).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
                    if (!committed && destination) await removeFile(destination);
                }
            })().catch(next);
        });
    });
}

for (const preview of [false, true]) {
    mediaRouter.get(preview ? "/:key/preview" : "/:key/original", (req, res, next) => {
        const row = mediaRow(keyOf(req));
        if (!row) throw new ApiError(404, "MEDIA_NOT_FOUND", "文件不存在");
        if (row.status !== "active") throw new ApiError(410, "MEDIA_CLEARED", "图片已清理");
        const path = preview ? row.preview_path : row.path;
        if (!path) throw new ApiError(404, "MEDIA_NOT_FOUND", "文件不存在");
        res.set({ "Content-Type": preview ? "image/webp" : row.mime_type, "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox; default-src 'none'" });
        res.sendFile(ownedPath(path), { cacheControl: false }, (error) => { if (error) next(error); });
    });
}

mediaRouter.delete("/:key", (req, res) => {
    const key = keyOf(req);
    const current = mediaRow(key);
    if (!current || current.status !== "active" || mediaIsReferenced(key)) return res.json({ data: { deleted: false } });
    db.transaction(() => {
        requireWritable(key, expectedRevision(req));
        for (const path of [current.path, current.preview_path]) if (path) {
            try { unlinkSync(ownedPath(path)); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
        }
        db.prepare("DELETE FROM media WHERE key = ?").run(key);
    })();
    res.json({ data: { deleted: true } });
});
