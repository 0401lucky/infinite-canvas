import { useCallback } from "react";
import { App } from "antd";
import { saveAs } from "file-saver";
import { useTranslation } from "react-i18next";

import { readMediaBlob } from "@/services/file-storage";
import { imageWasCleared, serverSessionSignal } from "@/services/api/server";

export function useDownloadMedia() {
    const { message } = App.useApp();
    const { t } = useTranslation();
    return useCallback(async (media: { storageKey?: string; url?: string }, filename: string) => {
        const signal = serverSessionSignal();
        try {
            const blob = await readMediaBlob(media);
            signal.throwIfAborted();
            if (!blob) throw new Error(t(imageWasCleared(media.storageKey) ? "server.imageCleared" : "server.mediaReadFailed"));
            saveAs(blob, filename);
        } catch (error) {
            if (error instanceof DOMException && error.name === "AbortError") return;
            message.error(error instanceof Error ? error.message : t("server.mediaReadFailed"));
        }
    }, [message, t]);
}
