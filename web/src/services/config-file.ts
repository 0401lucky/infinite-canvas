import { saveAs } from "file-saver";
import { nanoid } from "nanoid";

import i18n from "@/i18n";
import { normalizeChannelApiKeys, useConfigStore, type AiConfig, type WebdavSyncConfig } from "@/stores/use-config-store";
import { usePromptSourceStore, type PromptSourceSchedule } from "@/stores/use-prompt-source-store";
import type { PromptSource } from "@/services/api/prompt-source-presets";
import { serverSessionSignal } from "@/services/api/server";

type AppConfigFile = {
    app: "infinite-canvas";
    version: 1;
    exportedAt: string;
    config: AiConfig;
    webdav: WebdavSyncConfig;
    promptSources: {
        sources: PromptSource[];
        schedule: PromptSourceSchedule;
    };
};

export function exportAppConfig() {
    const { config, webdav } = useConfigStore.getState();
    const { sources, schedule } = usePromptSourceStore.getState();
    const data: AppConfigFile = { app: "infinite-canvas", version: 1, exportedAt: new Date().toISOString(), config, webdav, promptSources: { sources, schedule } };
    saveAs(new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" }), "infinite-canvas-config.json");
}

export async function importAppConfig(file: File) {
    if (useConfigStore.getState().sharedApiConfig) throw new Error(i18n.t("config.sharedApi.readOnly"));
    const signal = serverSessionSignal();
    let data: AppConfigFile;
    try {
        data = JSON.parse(await file.text()) as AppConfigFile;
    } catch {
        throw new Error(i18n.t("config.invalidFile"));
    }
    signal.throwIfAborted();
    if (data.app !== "infinite-canvas" || data.version !== 1 || !data.config || !Array.isArray(data.config.channels) || !data.webdav || !data.promptSources) throw new Error(i18n.t("config.invalidFile"));
    const current = useConfigStore.getState().config.channels;
    data.config.channels = data.config.channels.map((channel) => {
        if (!channel.apiKeys) return channel;
        const previous = current.find((item) => item.id === channel.id)?.apiKeys || [];
        const keys = channel.apiKeys.map((key) => {
            const old = previous.find((item) => item.id === key.id);
            return old && old.value.trim() !== key.value.trim() ? { ...key, id: nanoid() } : key;
        });
        return { ...channel, apiKeys: normalizeChannelApiKeys(keys) };
    });
    useConfigStore.setState({ config: data.config, webdav: data.webdav });
    usePromptSourceStore.setState(data.promptSources);
}
