import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const serverDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const env = z.object({
    PORT: z.coerce.number().int().positive().default(3001),
    APP_ORIGIN: z.url().refine((value) => ["http:", "https:"].includes(new URL(value).protocol)).default("http://localhost:3000"),
    DATA_DIR: z.string().default(resolve(serverDir, "../data")),
    SESSION_TTL_DAYS: z.coerce.number().int().positive().default(7),
    MAX_UPLOAD_MIB: z.coerce.number().int().positive().default(512),
    MAX_JSON_MIB: z.coerce.number().int().positive().default(32),
}).parse(process.env);

export const config = {
    port: env.PORT,
    origin: new URL(env.APP_ORIGIN).origin,
    secureCookie: new URL(env.APP_ORIGIN).protocol === "https:",
    dataDir: resolve(env.DATA_DIR),
    webDir: resolve(serverDir, "../web/dist"),
    sessionMs: env.SESSION_TTL_DAYS * 86400_000,
    uploadBytes: env.MAX_UPLOAD_MIB * 1024 * 1024,
    jsonBytes: env.MAX_JSON_MIB * 1024 * 1024,
};

export const imageDir = resolve(config.dataDir, "media/images");
const publicPath = relative(resolve(serverDir, "../web"), config.dataDir);
if (!publicPath || !isAbsolute(publicPath) && publicPath !== ".." && !publicPath.startsWith(`..${sep}`)) throw new Error("DATA_DIR 不能放在前端目录中");
export const mediaDir = resolve(config.dataDir, "media/files");
export const previewDir = resolve(config.dataDir, "previews");
export const uploadDir = resolve(config.dataDir, "uploads");
for (const dir of [config.dataDir, imageDir, mediaDir, previewDir, uploadDir]) mkdirSync(dir, { recursive: true });
