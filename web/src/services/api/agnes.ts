import i18n from "@/i18n";
import { imageSizePresets, inferMediaRatio, inferMediaScale, inferVideoRatio, parseAspectRatio, parsePixelSize } from "@/lib/media-size";
import { boolConfig, modelOptionName, type AiConfig } from "@/stores/use-config-store";
import type { AiTextMessage } from "./image";

const apiText = (key: string, options?: Record<string, unknown>) => i18n.t(`apiErrors.${key}`, options);
const IMAGE_RATIOS = ["1:1", "3:4", "4:3", "16:9", "9:16", "2:3", "3:2", "21:9"];

export type AgnesVideoResponse = { video_id?: string; status?: string; url?: string; error?: string | { message?: string }; message?: string; msg?: string };

export function buildAgnesVideoBody(config: AiConfig, prompt: string, referenceCount = 0) {
    if (referenceCount) throw new Error(apiText("agnesVideoReferencesUnsupported"));
    const seconds = Number(config.videoSeconds || "6");
    if (!Number.isInteger(seconds) || seconds < 4 || seconds > 12) throw new Error(apiText("agnesVideoSecondsUnsupported"));
    const resolution = (config.vquality || "auto").trim().toLowerCase();
    if (!["auto", "720", "720p", "high", "medium"].includes(resolution)) throw new Error(apiText("agnesVideoResolutionUnsupported"));
    // Default audio/watermark settings use the model's behavior, not independent switches.
    if (!boolConfig(config.videoGenerateAudio, true) || boolConfig(config.videoWatermark, false)) throw new Error(apiText("agnesVideoOptionsUnsupported"));
    const ratio = inferVideoRatio(config.size || "16:9");
    return { model: modelOptionName(config.model), prompt, seconds: String(seconds), size: "720P", aspect_ratio: ratio === "auto" ? "16:9" : ratio, mode: "text" };
}

export function agnesVideoTaskId(payload: AgnesVideoResponse) {
    const id = typeof payload.video_id === "string" ? payload.video_id.trim() : "";
    if (!id) throw new Error(apiText("agnesNoVideoId"));
    return id;
}

export function agnesVideoQueryUrl(baseUrl: string, id: string, model: string) {
    const url = new URL("/agnesapi", baseUrl);
    url.search = new URLSearchParams({ video_id: id, model_name: modelOptionName(model) }).toString();
    return url.toString();
}

export function agnesVideoTaskState(payload: AgnesVideoResponse): { status: "pending" } | { status: "completed"; url: string } | { status: "failed"; error: string } {
    if (payload.status === "failed" || payload.status === "cancelled") {
        return { status: "failed", error: (typeof payload.error === "string" ? payload.error : payload.error?.message) || payload.message || payload.msg || apiText("videoGenerationFailed") };
    }
    if (payload.status !== "completed") return { status: "pending" };
    const url = typeof payload.url === "string" ? payload.url.trim() : "";
    return /^https?:\/\//i.test(url) ? { status: "completed", url } : { status: "failed", error: apiText("noPlayableVideo") };
}

export function agnesVideoQueueError(payload: unknown) {
    const value = payload as { code?: unknown; error?: { code?: unknown } } | null;
    return value?.code === "video_queue_full" || value?.error?.code === "video_queue_full" ? apiText("agnesVideoQueueFull") : "";
}

function agnesImageParams(config: AiConfig) {
    if (config.quality && config.quality !== "auto") throw new Error(apiText("agnesImageQualityUnsupported"));
    if (config.background?.trim()) throw new Error(apiText("agnesImageBackgroundUnsupported"));
    const value = config.size.trim();
    if (!value || value === "auto") return { size: "1K" };
    const pixels = parsePixelSize(value);
    if (pixels) {
        if (!pixels.width || !pixels.height) throw new Error(apiText("positiveImageDimensions"));
        const size = `${pixels.width}x${pixels.height}`;
        // Only known presets become tiers; custom dimensions retain their exact intent.
        if (!Object.values(imageSizePresets).some((presets) => Object.values(presets).includes(size))) return { size };
        const ratio = inferMediaRatio(size);
        if (!IMAGE_RATIOS.includes(ratio)) throw new Error(apiText("agnesImageRatioUnsupported", { ratio }));
        return { size: inferMediaScale(size).toUpperCase(), ratio };
    }
    if (!parseAspectRatio(value)) throw new Error(apiText("invalidImageSizeFormat"));
    if (!IMAGE_RATIOS.includes(value)) throw new Error(apiText("agnesImageRatioUnsupported", { ratio: value }));
    return { size: "1K", ratio: value };
}

export function buildAgnesImageBody(config: AiConfig, prompt: string, images: string[] = []) {
    return {
        model: modelOptionName(config.model), prompt, n: 1, ...agnesImageParams(config),
        ...(images.length ? { extra_body: { image: images, response_format: "b64_json" } } : { return_base64: true }),
    };
}

export function agnesUsesChat(messages: AiTextMessage[]) {
    return messages.some((message) => Array.isArray(message.content) && message.content.some((item) => item.type === "image_url"));
}

export function buildAgnesChatBody(config: AiConfig, messages: AiTextMessage[]) {
    return {
        model: modelOptionName(config.model), messages,
        ...(config.reasoningEffort === "auto" ? {} : { reasoning_effort: config.reasoningEffort === "xhigh" ? "max" : config.reasoningEffort }),
    };
}
