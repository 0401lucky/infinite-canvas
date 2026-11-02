import { z } from "zod";

import { adminStorage } from "./storage.js";

const apiFormat = z.enum(["openai", "gemini", "agnes"]);
const sharedConfig = z.object({
    baseUrl: z.string().default(""),
    apiKey: z.string().default(""),
    apiFormat: apiFormat.default("openai"),
    channels: z.array(z.object({
        id: z.string(), name: z.string(), baseUrl: z.string(), apiKey: z.string(), apiFormat,
        models: z.array(z.object({ name: z.string(), capability: z.enum(["image", "video", "text", "audio"]), script: z.string().optional() })),
    })).default([]),
    models: z.array(z.string()).default([]),
    model: z.string().default(""),
    imageModel: z.string().default(""),
    videoModel: z.string().default(""),
    textModel: z.string().default(""),
    audioModel: z.string().default(""),
});

export function readSharedApiConfig() {
    const record = adminStorage.readRecord("app_state", "infinite-canvas:ai_config_store");
    const value = record.value as { state?: { config?: unknown } } | null;
    // Explicitly project API fields; never expose WebDAV, prompts or other admin preferences.
    return sharedConfig.parse(value?.state?.config ?? {});
}
