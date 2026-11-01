import type { ReactNode } from "react";
import { useEffect } from "react";
import { App } from "antd";
import { useTranslation } from "react-i18next";

import { useConfigStore } from "@/stores/use-config-store";
import { usePromptSourceScheduler } from "@/hooks/use-prompt-source-scheduler";
import { flushAppStorage, useUserStore } from "@/stores/use-user-store";
import { reportStorageError, useStorageStore } from "@/stores/use-storage-store";
import { serverSessionSignal } from "@/services/api/server";

let pendingCredentials: { baseUrl: string | null; apiKey: string | null } | null = null;
export function captureChannelCredentials() {
    const search = new URLSearchParams(window.location.search);
    const baseUrl = search.get("baseUrl") || search.get("baseurl");
    const apiKey = search.get("apiKey") || search.get("apikey");
    if (!baseUrl && !apiKey) return;
    pendingCredentials = { baseUrl, apiKey };
    ["baseUrl", "baseurl", "apiKey", "apikey"].forEach((key) => search.delete(key));
    window.history.replaceState(null, "", `${window.location.pathname}${search.size ? `?${search}` : ""}${window.location.hash}`);
}

captureChannelCredentials();

export function ClientRootInit({ children }: { children: ReactNode }) {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const importChannelCredentials = useConfigStore((state) => state.importChannelCredentials);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const ready = useUserStore((state) => state.ready);
    const sessionExpired = useStorageStore((state) => state.sessionExpired);
    const error = useStorageStore((state) => state.error);
    const errorId = useStorageStore((state) => state.errorId);

    usePromptSourceScheduler();

    useEffect(() => { void useUserStore.getState().restoreSession(); }, []);
    useEffect(() => { if (sessionExpired) useUserStore.getState().clearSession(); }, [sessionExpired]);
    useEffect(() => { if (error) message.error({ content: error, key: "server-storage-error" }); }, [errorId, message]);
    useEffect(() => {
        const prevent = (event: BeforeUnloadEvent) => {
            const state = useStorageStore.getState();
            if (!state.pending && !state.canvasQueued && !Object.keys(state.failedWrites).length) return;
            event.preventDefault();
            event.returnValue = "";
        };
        window.addEventListener("beforeunload", prevent);
        return () => window.removeEventListener("beforeunload", prevent);
    }, []);

    useEffect(() => {
        if (!ready || !pendingCredentials) return;
        const input = pendingCredentials;
        pendingCredentials = null;
        const result = importChannelCredentials(input);
        openConfigDialog(false, "channels");
        if (result.status === "created" || result.status === "updated") {
            const signal = serverSessionSignal();
            void flushAppStorage().then(() => {
                signal.throwIfAborted();
                message.success(t(result.status === "created" ? "config.importedChannelCreated" : "config.importedChannelUpdated", { name: result.channelName }));
            }).catch(reportStorageError);
        } else if (result.status === "missing-base-url") message.error(t("config.importedChannelBaseUrlRequired"));
        else message.error(t("config.importedChannelBaseUrlInvalid"));
    }, [importChannelCredentials, message, openConfigDialog, ready, t]);

    return <>{children}</>;
}
