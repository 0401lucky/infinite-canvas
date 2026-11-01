import { existsSync } from "node:fs";
import express, { type ErrorRequestHandler, type Request } from "express";
import multer from "multer";
import { z } from "zod";

import { authRouter, checkOrigin, cookies, initializeAdmin, requireSession } from "./auth.js";
import { config } from "./config.js";
import { clearImages, mediaRouter, storageUsage } from "./media.js";
import { ApiError, readRecord, readRecords, replaceRecords, saveRecord } from "./storage.js";

await initializeAdmin();
const app = express();
app.disable("x-powered-by");
app.use("/api", (_req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
app.use("/api", cookies, checkOrigin);
const json = express.json({ limit: config.jsonBytes });
app.use("/api/auth", json, authRouter);
app.use("/api", requireSession);
app.use("/api/media", mediaRouter);
app.get("/api/storage", async (_req, res) => res.json({ data: await storageUsage() }));
app.delete("/api/storage/images", async (_req, res) => res.json({ data: await clearImages() }));

const namespaceSchema = z.string().refine((value) => ["app_state", "image_generation_logs", "video_generation_logs", "prompt_cache"].includes(value) || (value.startsWith("plugin:") && value.length > 7));
const namespace = (req: Request) => namespaceSchema.parse(req.params.namespace);
const key = (req: Request) => z.string().min(1).parse(req.params.key);
const revision = (req: Request) => z.coerce.number().int().nonnegative().parse(req.get("if-match"));
app.get("/api/records/:namespace", (req, res) => res.json({ data: readRecords(namespace(req)) }));
app.get("/api/records/:namespace/:key", (req, res) => res.json({ data: readRecord(namespace(req), key(req)) }));
app.put("/api/records/:namespace/:key", json, requireSession, (req, res) => {
    const body = z.object({ value: z.unknown() }).parse(req.body);
    res.json({ data: saveRecord(namespace(req), key(req), body.value, revision(req)) });
});
app.delete("/api/records/:namespace/:key", (req, res) => res.json({ data: saveRecord(namespace(req), key(req), null, revision(req), true) }));
app.put("/api/records/:namespace", json, requireSession, (req, res) => {
    const items = z.array(z.object({ key: z.string().min(1), value: z.unknown() })).parse(req.body?.records);
    res.json({ data: replaceRecords(namespace(req), items, revision(req)) });
});
app.delete("/api/records/:namespace", (req, res) => res.json({ data: replaceRecords(namespace(req), [], revision(req)) }));
app.use("/api", (_req, _res, next) => next(new ApiError(404, "NOT_FOUND", "接口不存在")));

app.get("/health", (_req, res) => res.json({ ok: true }));
app.get("/config.js", (_req, res) => {
    res.set("Cache-Control", "no-store").type("application/javascript").send(`window.__RUNTIME_CONFIG__ = ${JSON.stringify({ ANALYTICS_GA4_ID: process.env.ANALYTICS_GA4_ID || "", ANALYTICS_BAIDU_ID: process.env.ANALYTICS_BAIDU_ID || "" })};`);
});
if (existsSync(config.webDir)) {
    app.use(express.static(config.webDir));
    app.get("/{*path}", (_req, res) => res.sendFile("index.html", { root: config.webDir }));
}

const errors: ErrorRequestHandler = (error, _req, res, next) => {
    if (res.headersSent) return next(error);
    if (error instanceof ApiError) return res.status(error.status).json({ error: { code: error.code, message: error.message } });
    if (error instanceof z.ZodError || error?.type === "entity.parse.failed") return res.status(400).json({ error: { code: "INVALID_REQUEST", message: "请求参数无效" } });
    if ((error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") || error?.type === "entity.too.large") return res.status(413).json({ error: { code: "REQUEST_TOO_LARGE", message: "请求超过配置的大小限制" } });
    if (error instanceof multer.MulterError) return res.status(400).json({ error: { code: "INVALID_REQUEST", message: "上传格式无效" } });
    if (error?.status === 416) return res.set(error.headers || {}).status(416).json({ error: { code: "INVALID_RANGE", message: "请求的文件范围无效" } });
    if (error?.code === "ENOENT") return res.status(404).json({ error: { code: "MEDIA_NOT_FOUND", message: "文件不存在" } });
    console.error("Application storage error", { name: error?.name, code: error?.code });
    res.status(500).json({ error: { code: "STORAGE_FAILED", message: "服务端存储失败，请检查数据目录与服务状态" } });
};
app.use(errors);
const server = app.listen(config.port, "0.0.0.0", () => console.log(`Infinite Canvas listening on ${config.port}`));
server.requestTimeout = 0;
