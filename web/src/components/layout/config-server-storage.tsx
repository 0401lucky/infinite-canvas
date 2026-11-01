import { Alert, App, Button, Spin, theme } from "antd";
import { Database, HardDrive, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { readServerStorageUsage, type ServerStorageUsage } from "@/services/api/server";
import { useUserStore } from "@/stores/use-user-store";

export function ConfigServerStorage({ active }: { active: boolean }) {
    const { t } = useTranslation();
    const { token } = theme.useToken();
    const { message, modal } = App.useApp();
    const [usage, setUsage] = useState<ServerStorageUsage | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const refresh = useCallback(async () => {
        setLoading(true);
        setError("");
        try { setUsage(await readServerStorageUsage()); }
        catch (reason) { setError(reason instanceof Error ? reason.message : t("config.serverStorage.readFailed")); }
        finally { setLoading(false); }
    }, [t]);

    useEffect(() => { if (active) void refresh(); }, [active, refresh]);

    const clearImages = () => modal.confirm({
        title: t("config.serverStorage.clearTitle"),
        content: t("config.serverStorage.clearDescription"),
        okText: t("config.serverStorage.clear"),
        cancelText: t("common.cancel"),
        okButtonProps: { danger: true },
        onOk: async () => {
            try {
                await useUserStore.getState().clearImages();
                message.success(t("config.serverStorage.cleared"));
            } catch (reason) {
                message.error(reason instanceof Error ? reason.message : t("config.serverStorage.clearFailed"));
                await refresh();
                throw reason;
            }
        },
    });

    return (
        <section className="space-y-5 p-1">
            <header className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h3 className="flex items-center gap-2 text-sm font-semibold"><Database className="size-4" />{t("config.serverStorage.title")}</h3>
                    <p className="mt-2 text-xs leading-6" style={{ color: token.colorTextSecondary }}>{t("config.serverStorage.description")}</p>
                </div>
                <Button type="text" icon={<RefreshCw className="size-4" />} loading={loading} onClick={() => void refresh()}>{t("config.serverStorage.refresh")}</Button>
            </header>
            {error ? <Alert type="error" showIcon title={t("config.serverStorage.readFailed")} description={error} /> : null}
            {!usage && loading ? <div className="flex min-h-40 items-center justify-center"><Spin /></div> : usage ? (
                <>
                    <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
                        {[
                            { label: "images", bytes: usage.imageBytes, count: usage.images },
                            { label: "previews", bytes: usage.previewBytes, count: usage.previews },
                            { label: "media", bytes: usage.mediaBytes },
                            { label: "database", bytes: usage.databaseBytes },
                        ].map((item) => <div key={item.label}>
                            <div className="text-xs" style={{ color: token.colorTextSecondary }}>{t(`config.serverStorage.${item.label}`)}</div>
                            <div className="mt-2 text-xl font-semibold tabular-nums">{formatBytes(item.bytes)}</div>
                            {item.count !== undefined ? <div className="mt-1 text-xs" style={{ color: token.colorTextTertiary }}>{t("config.serverStorage.count", { count: item.count })}</div> : null}
                        </div>)}
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-4 border-t pt-5" style={{ borderColor: token.colorBorderSecondary }}>
                        <div><div className="flex items-center gap-2 text-xs" style={{ color: token.colorTextSecondary }}><HardDrive className="size-4" />{t("config.serverStorage.total")}</div><div className="mt-2 text-2xl font-semibold tabular-nums">{formatBytes(usage.totalBytes)}</div><p className="mt-1 text-xs" style={{ color: token.colorTextTertiary }}>{t("config.serverStorage.totalHint")}</p></div>
                        <Button type="text" danger icon={<Trash2 className="size-4" />} disabled={loading || !usage.images && !usage.previews} onClick={clearImages}>{t("config.serverStorage.clear")}</Button>
                    </div>
                </>
            ) : null}
        </section>
    );
}

function formatBytes(bytes: number) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`;
    if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
    return `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
}
