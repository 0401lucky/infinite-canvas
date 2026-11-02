import { afterAll, afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import axios, { AxiosError, type AxiosResponse } from "axios";
import type { AiConfig, ApiCallFormat, SharedApiConfig } from "../src/stores/use-config-store";
import type { AiTextMessage } from "../src/services/api/image";
import type { VideoGenerationTask } from "../src/services/api/video";

const values = new Map<string, string>();
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
    },
});
afterAll(() => {
    if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
    else Reflect.deleteProperty(globalThis, "localStorage");
});

const { AGNES_BASE_URL, AGNES_FLASH_MODELS, createModelChannel, defaultConfig, encodeChannelModel, modelOptionsFromChannels, resolveModelRequestConfig, useConfigStore } = await import("../src/stores/use-config-store");
const { agnesUsesChat, agnesVideoQueryUrl, agnesVideoTaskId, agnesVideoTaskState, buildAgnesChatBody, buildAgnesImageBody, buildAgnesVideoBody } = await import("../src/services/api/agnes");
const { requestGeneration, requestImageQuestion } = await import("../src/services/api/image");
const { createVideoGenerationTask, pollVideoGenerationTask, storeGeneratedVideo } = await import("../src/services/api/video");
const { resetServerSession, serverSessionSignal } = await import("../src/services/api/server");
const { default: i18n } = await import("../src/i18n");

beforeEach(() => {
    resetServerSession("test-user");
    useConfigStore.setState(useConfigStore.getInitialState(), true);
});
afterEach(() => {
    mock.restore();
    resetServerSession();
});

function configFor(model: string, apiFormat: ApiCallFormat = "agnes"): AiConfig {
    const channel = createModelChannel({ id: "selected", name: "Selected", apiFormat, baseUrl: AGNES_BASE_URL, apiKey: "test-key", models: AGNES_FLASH_MODELS });
    return { ...defaultConfig, channels: [channel], models: modelOptionsFromChannels([channel]), model: encodeChannelModel(channel.id, model) };
}
function sharedConfigFor(): SharedApiConfig {
    const { channels, models, model } = configFor("agnes-2.5-flash");
    return {
        baseUrl: AGNES_BASE_URL, apiKey: "shared-test-key", apiFormat: "agnes", channels, models, model,
        imageModel: encodeChannelModel("selected", "agnes-image-2.5-flash"), videoModel: encodeChannelModel("selected", "agnes-video-2.5-flash"), textModel: model, audioModel: "",
    };
}
const reply = (data: unknown) => ({ data } as AxiosResponse);
const vision: AiTextMessage[] = [
    { role: "user", content: "Earlier question" },
    { role: "assistant", content: "Earlier answer" },
    { role: "user", content: [{ type: "text", text: "Describe this image" }, { type: "image_url", image_url: { url: "data:image/png;base64,reference" } }] },
];
function sse(data: string, fragmented = false) {
    const bytes = new TextEncoder().encode(data);
    return new Response(new ReadableStream<Uint8Array>({ start(controller) {
        if (fragmented) bytes.forEach((byte) => controller.enqueue(Uint8Array.of(byte)));
        else controller.enqueue(bytes);
        controller.close();
    } }), { headers: { "Content-Type": "text/event-stream" } });
}
const chatEvents = `data: ${JSON.stringify({ choices: [{ delta: { content: "\u732b" } }] })}\r\n\r\ndata: ${JSON.stringify({ choices: [{ delta: { content: "\u54aa" } }] })}\n\ndata: [DONE]\n\n`;

test("the explicit preset contains only the six approved Flash models and preserves removed models", () => {
    const config = configFor("agnes-video-2.5-flash");
    expect(config.channels[0].models.map((model) => model.name)).toEqual([
        "agnes-2.5-flash", "agnes-3.0-flash", "agnes-image-2.0-flash", "agnes-image-2.1-flash", "agnes-image-2.5-flash", "agnes-video-2.5-flash",
    ]);
    const merge = useConfigStore.persist.getOptions().merge!;
    const saved = { ...config, channels: [{ ...config.channels[0], models: [] }] };
    const restored = merge({ config: JSON.parse(JSON.stringify(saved)) }, useConfigStore.getState());
    expect(restored.config.channels[0].apiFormat).toBe("agnes");
    expect(restored.config.channels[0].baseUrl).toBe(AGNES_BASE_URL);
    expect(restored.config.channels[0].models).toEqual([]);
    expect(createModelChannel({ apiFormat: "agnes" }).models).toEqual([]);
    const withoutAgnes = merge({ config: defaultConfig }, useConfigStore.getState());
    expect(withoutAgnes.config.channels.some((channel) => channel.apiFormat === "agnes")).toBe(false);
    const empty = merge({ config: { ...config, apiFormat: "agnes", channels: [] } }, useConfigStore.getState());
    expect(empty.config.channels).toEqual([]);
    expect(empty.config.models).toEqual([]);
    const fresh = merge(null, useConfigStore.getState()).config;
    expect(fresh.channels).toHaveLength(defaultConfig.channels.length);
    expect(fresh.channels[0].id).toBe(defaultConfig.channels[0].id);
    expect(fresh.channels[0].models.map((model) => model.name)).toEqual(defaultConfig.channels[0].models.map((model) => model.name));
});

test("an Agnes hostname or model name never converts an OpenAI channel implicitly", () => {
    const config = configFor("agnes-2.5-flash", "openai");
    expect(resolveModelRequestConfig(config, config.model).apiFormat).toBe("openai");
    const changed = createModelChannel({ ...config.channels[0], apiFormat: "agnes", models: [{ name: "kept", capability: "text", script: "return 'kept';" }] });
    expect(changed.apiKey).toBe(config.channels[0].apiKey);
    expect(changed.models[0].script).toBe("return 'kept';");
});

test("member hydration inherits Agnes while private preferences and removed selections stay private", () => {
    const sharedApiConfig = sharedConfigFor();
    const options = useConfigStore.persist.getOptions();
    const current = { ...useConfigStore.getState(), sharedApiConfig };
    const fresh = options.merge!(null, current);
    expect(fresh.config.apiFormat).toBe("agnes");
    expect(fresh.config.channels).toEqual(sharedApiConfig.channels);
    expect(fresh.config.textModel).toBe(sharedApiConfig.textModel);
    const restored = options.merge!({ config: { channels: defaultConfig.channels, apiKey: "stale-private-key", textModel: "removed::model", systemPrompt: "Private prompt" } }, current);
    expect(restored.config.channels).toEqual(sharedApiConfig.channels);
    expect(restored.config.apiKey).toBe(sharedApiConfig.apiKey);
    expect(restored.config.textModel).toBe("removed::model");
    expect(restored.config.systemPrompt).toBe("Private prompt");
    const persisted = options.partialize!(restored);
    for (const key of ["baseUrl", "apiKey", "apiFormat", "channels", "models"]) expect(persisted.config).not.toHaveProperty(key);
    expect(persisted.config).toMatchObject({ textModel: "removed::model", systemPrompt: "Private prompt" });
    expect(persisted).not.toHaveProperty("sharedApiConfig");
});

test("empty shared providers remain empty and member edits cannot replace the shared catalog", () => {
    const sharedApiConfig = { ...sharedConfigFor(), channels: [], models: [] };
    const restored = useConfigStore.persist.getOptions().merge!({ config: defaultConfig }, { ...useConfigStore.getState(), sharedApiConfig });
    expect(restored.config.channels).toEqual([]);
    expect(restored.config.models).toEqual([]);
    useConfigStore.setState(restored);
    const { updateConfig, importChannelCredentials } = useConfigStore.getState();
    updateConfig("channels", defaultConfig.channels);
    updateConfig("apiKey", "member-key");
    expect(importChannelCredentials({ baseUrl: AGNES_BASE_URL, apiKey: "member-key" }).status).toBe("read-only");
    expect(useConfigStore.getState().config.channels).toEqual([]);
    expect(useConfigStore.getState().config.apiKey).toBe(sharedApiConfig.apiKey);
    updateConfig("textModel", "selected::personal-choice");
    expect(useConfigStore.getState().config.textModel).toBe("selected::personal-choice");
});

test("shared Agnes refresh binds the account and preserves a removed personal selection", async () => {
    const sharedApiConfig = sharedConfigFor();
    useConfigStore.setState({ sharedApiConfig, config: { ...defaultConfig, ...sharedApiConfig } });
    const updated = { ...sharedApiConfig, channels: [{ ...sharedApiConfig.channels[0], models: [] }], models: [] };
    const fetch = spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: updated }), { headers: { "Content-Type": "application/json" } }));
    await useConfigStore.getState().refreshSharedApiConfig();
    expect(String(fetch.mock.calls[0][0])).toBe("/api/shared-api-config");
    expect(new Headers(fetch.mock.calls[0][1]?.headers).get("X-Canvas-User")).toBe("test-user");
    expect(useConfigStore.getState().config.channels[0].apiFormat).toBe("agnes");
    expect(useConfigStore.getState().config.models).toEqual([]);
    expect(useConfigStore.getState().config.textModel).toBe(sharedApiConfig.textModel);
    expect(useConfigStore.getState().isAiConfigReady(useConfigStore.getState().config, sharedApiConfig.textModel)).toBe(false);
    fetch.mockRejectedValue(new Error("Unavailable"));
    await expect(useConfigStore.getState().refreshSharedApiConfig()).rejects.toThrow();
    expect(useConfigStore.getState().sharedApiConfig).toEqual(updated);
});

test("video creation sends only JSON text-video fields with the unchanged six-second default", () => {
    expect(buildAgnesVideoBody(configFor("agnes-video-2.5-flash"), "A cat")).toEqual({
        model: "agnes-video-2.5-flash", prompt: "A cat", seconds: "6", size: "720P", aspect_ratio: "1:1", mode: "text",
    });
    for (const patch of [{ videoSeconds: "13" }, { videoSeconds: "3" }, { videoSeconds: "4.5" }, { vquality: "1080" }, { videoGenerateAudio: "false" }, { videoWatermark: "true" }]) {
        expect(() => buildAgnesVideoBody({ ...configFor("agnes-video-2.5-flash"), ...patch }, "A cat")).toThrow();
    }
});

test("video_id is required and neither id nor task_id is substituted", () => {
    expect(agnesVideoTaskId({ video_id: "correct-video" })).toBe("correct-video");
    const wrongIdentity = { video_id: "", id: "wrong", task_id: "wrong" };
    expect(() => agnesVideoTaskId(wrongIdentity)).toThrow(i18n.t("apiErrors.agnesNoVideoId"));
    const url = new URL(agnesVideoQueryUrl(`${AGNES_BASE_URL}/v1`, "id&with?symbols", "selected::agnes-video-2.5-flash"));
    expect(url.pathname).toBe("/agnesapi");
    expect(url.searchParams.get("video_id")).toBe("id&with?symbols");
    expect(url.searchParams.get("model_name")).toBe("agnes-video-2.5-flash");
});

test("only completed videos use the top-level URL, and completed without URL is a failure", () => {
    expect(agnesVideoTaskState({ status: "processing", url: "https://example.com/not-ready.mp4" }).status).toBe("pending");
    expect(agnesVideoTaskState({ status: "failed", url: "https://example.com/failed.mp4", error: { message: "Provider failure" } })).toEqual({ status: "failed", error: "Provider failure" });
    expect(agnesVideoTaskState({ status: "completed" }).status).toBe("failed");
    expect(agnesVideoTaskState({ status: "completed", url: "not-a-video-url" }).status).toBe("failed");
    expect(agnesVideoTaskState({ status: "completed", url: "https://example.com/result.mp4" })).toEqual({ status: "completed", url: "https://example.com/result.mp4" });
});

test("video creation and JSON-restored tasks retain Agnes identity and root-path polling", async () => {
    const config = configFor("agnes-video-2.5-flash");
    const post = spyOn(axios, "post").mockResolvedValue(reply({ id: "different-id", video_id: "video-id" }));
    const get = spyOn(axios, "get").mockResolvedValue(reply({ status: "queued" }));
    const task = await createVideoGenerationTask(config, "A cat");
    expect(task).toEqual({ id: "video-id", provider: "agnes", model: config.model });
    expect(post.mock.calls[0][1]).not.toBeInstanceOf(FormData);
    const restored = JSON.parse(JSON.stringify(task)) as VideoGenerationTask;
    expect(await pollVideoGenerationTask(config, restored)).toEqual({ status: "pending" });
    expect(new URL(get.mock.calls[0][0]).pathname).toBe("/agnesapi");
    expect(new URL(get.mock.calls[0][0]).searchParams.get("model_name")).toBe("agnes-video-2.5-flash");
});

test("queue-full creation fails once without producing a task or retrying", async () => {
    const error = new AxiosError("Queue full", "ERR_BAD_RESPONSE", undefined, undefined, { status: 503, data: { code: "video_queue_full" } } as AxiosResponse);
    const post = spyOn(axios, "post").mockRejectedValue(error);
    await expect(createVideoGenerationTask(configFor("agnes-video-2.5-flash"), "A cat")).rejects.toThrow(i18n.t("apiErrors.agnesVideoQueueFull"));
    expect(post).toHaveBeenCalledTimes(1);
});

test("private video references are blocked before reading or posting media", async () => {
    const post = spyOn(axios, "post").mockResolvedValue(reply({ video_id: "must-not-create" }));
    const fetch = spyOn(globalThis, "fetch").mockRejectedValue(new Error("Must not read private media"));
    const reference = { id: "ref", name: "ref.png", type: "image/png", dataUrl: "/api/media/private", storageKey: "image:private" };
    await expect(createVideoGenerationTask(configFor("agnes-video-2.5-flash"), "A cat", [reference])).rejects.toThrow(i18n.t("apiErrors.agnesVideoReferencesUnsupported"));
    expect(post).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
});

test("provider changes and removed models block recovery without querying another protocol", async () => {
    const config = configFor("agnes-video-2.5-flash");
    const task: VideoGenerationTask = { id: "saved-id", provider: "agnes", model: config.model };
    const get = spyOn(axios, "get").mockResolvedValue(reply({ status: "queued" }));
    const switched: AiConfig = { ...config, channels: [{ ...config.channels[0], apiFormat: "openai" }] };
    await expect(pollVideoGenerationTask(switched, task)).rejects.toThrow(i18n.t("apiErrors.videoTaskProviderMismatch"));
    await expect(pollVideoGenerationTask({ ...config, channels: [{ ...config.channels[0], models: [] }] }, task)).rejects.toThrow(i18n.t("apiErrors.videoModelUnavailable"));
    expect(task.id).toBe("saved-id");
    expect(get).not.toHaveBeenCalled();
});

test("Agnes images use tiers, exact custom dimensions, and extra_body.image without GPT fields", () => {
    const config = configFor("agnes-image-2.5-flash");
    expect(buildAgnesImageBody({ ...config, size: "auto" }, "A cat")).toEqual({ model: "agnes-image-2.5-flash", prompt: "A cat", n: 1, size: "1K", return_base64: true });
    const edited = buildAgnesImageBody({ ...config, size: "2048x1152" }, "Edit a cat", ["original-one", "original-two"]);
    expect(edited).toEqual({ model: "agnes-image-2.5-flash", prompt: "Edit a cat", n: 1, size: "2K", ratio: "16:9", extra_body: { image: ["original-one", "original-two"], response_format: "b64_json" } });
    expect(buildAgnesImageBody({ ...config, size: "1200x1600" }, "A cat").size).toBe("1200x1600");
    for (const patch of [{ quality: "high" }, { background: "transparent" }, { size: "9:21" }, { size: "864x2016" }]) {
        expect(() => buildAgnesImageBody({ ...config, ...patch }, "A cat")).toThrow();
    }
});

test("three images stay three independent n=1 requests with the existing image timeout", async () => {
    const post = spyOn(axios, "post").mockResolvedValue(reply({ data: [{ b64_json: "image" }] }));
    const images = await requestGeneration({ ...configFor("agnes-image-2.5-flash"), count: "3" }, "A cat");
    expect(images).toHaveLength(3);
    expect(post).toHaveBeenCalledTimes(3);
    for (const [, body, options] of post.mock.calls) {
        expect(body).toMatchObject({ n: 1 });
        expect(body).not.toHaveProperty("output_format");
        expect(body).not.toHaveProperty("response_format");
        expect(options?.timeout).toBe(10 * 60_000);
    }
});

test("saved scripts retain priority over Agnes image validation and protocol", async () => {
    const config = configFor("agnes-image-2.5-flash");
    config.channels = [{ ...config.channels[0], models: config.channels[0].models.map((model) => ({ ...model, script: "return ['data:image/png;base64,script-result'];" })) }];
    const post = spyOn(axios, "post").mockResolvedValue(reply({ data: [] }));
    expect((await requestGeneration({ ...config, quality: "high", background: "transparent" }, "A cat"))[0].dataUrl).toBe("data:image/png;base64,script-result");
    expect(post).not.toHaveBeenCalled();
});

test("Chat reasoning maps xhigh to max, omits auto, and preserves other approved efforts", () => {
    const config = configFor("agnes-2.5-flash");
    expect(agnesUsesChat(vision)).toBe(true);
    expect(agnesUsesChat([{ role: "user", content: "Text only" }])).toBe(false);
    expect(buildAgnesChatBody(config, vision)).not.toHaveProperty("reasoning_effort");
    for (const effort of ["low", "medium", "high", "xhigh"] as const) {
        expect(buildAgnesChatBody({ ...config, reasoningEffort: effort }, vision).reasoning_effort).toBe(effort === "xhigh" ? "max" : effort);
    }
});

test("vision Chat SSE reuses fragmented UTF-8 decoding and emits cumulative text", async () => {
    const fetch = spyOn(globalThis, "fetch").mockResolvedValue(sse(chatEvents, true));
    const deltas: string[] = [];
    expect(await requestImageQuestion({ ...configFor("agnes-2.5-flash"), systemPrompt: "System", reasoningEffort: "xhigh" }, vision, (text) => deltas.push(text))).toBe("\u732b\u54aa");
    expect(deltas).toEqual(["\u732b", "\u732b\u54aa"]);
    expect(String(fetch.mock.calls[0][0])).toBe(`${AGNES_BASE_URL}/v1/chat/completions`);
    const body = JSON.parse(String(fetch.mock.calls[0][1]?.body));
    expect(body.messages).toEqual([{ role: "system", content: "System" }, ...vision]);
    expect(body.reasoning_effort).toBe("max");
    expect(body.stream).toBe(true);
});

test("vision Chat accepts a regular JSON reply instead of treating it as empty SSE", async () => {
    spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: "A cat" } }] }), { headers: { "Content-Type": "application/json" } }));
    const deltas: string[] = [];
    expect(await requestImageQuestion(configFor("agnes-3.0-flash"), vision, (text) => deltas.push(text))).toBe("A cat");
    expect(deltas).toEqual(["A cat"]);
});

test("plain Agnes text and unconverted OpenAI vision retain Responses and xhigh", async () => {
    const fetch = spyOn(globalThis, "fetch").mockImplementation(async () => sse('data: {"type":"response.output_text.delta","delta":"OK"}\n\n'));
    for (const [apiFormat, messages] of [["agnes", [{ role: "user", content: "Text" }]], ["openai", vision]] as const) {
        await requestImageQuestion({ ...configFor("agnes-2.5-flash", apiFormat), reasoningEffort: "xhigh" }, [...messages], () => {});
    }
    for (const [url, options] of fetch.mock.calls) {
        expect(String(url)).toBe(`${AGNES_BASE_URL}/v1/responses`);
        const body = JSON.parse(String(options?.body));
        expect(body.reasoning).toEqual({ effort: "xhigh" });
        expect(body).not.toHaveProperty("messages");
    }
});

test("ending a session stops further stream callbacks and old-session media writes", async () => {
    const fetch = spyOn(globalThis, "fetch").mockResolvedValue(sse(chatEvents));
    const signal = serverSessionSignal();
    const deltas: string[] = [];
    await expect(requestImageQuestion(configFor("agnes-2.5-flash"), vision, (text) => { deltas.push(text); resetServerSession(); })).rejects.toThrow();
    expect(deltas).toEqual(["\u732b"]);
    resetServerSession("other-user");
    await expect(storeGeneratedVideo({ blob: new Blob(["old video"], { type: "video/mp4" }) }, { signal })).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
});
