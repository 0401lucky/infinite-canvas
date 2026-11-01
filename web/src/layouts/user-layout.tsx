import type { ReactNode } from "react";
import { Alert, Button, Spin } from "antd";
import { Navigate, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { AgentPanel } from "@/components/agent/agent-panel";
import { AppTopNav } from "@/components/layout/app-top-nav";
import { useUserStore } from "@/stores/use-user-store";
import { reportStorageError } from "@/stores/use-storage-store";

export default function UserLayout({ children }: { children: ReactNode }) {
    const { t } = useTranslation();
    const location = useLocation();
    const status = useUserStore((state) => state.status);
    const ready = useUserStore((state) => state.ready);
    const loading = useUserStore((state) => state.loading);
    const error = useUserStore((state) => state.error);
    const dataEpoch = useUserStore((state) => state.dataEpoch);
    if (status === "anonymous") return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}${location.hash}` }} />;
    if (!ready) return (
        <main className="flex h-dvh items-center justify-center bg-background px-6 text-foreground">
            {error ? <div className="w-full max-w-lg space-y-4"><Alert type="error" showIcon title={t("server.loadFailed")} description={error} /><div className="flex gap-2"><Button onClick={() => void (status === "error" ? useUserStore.getState().restoreSession() : useUserStore.getState().reloadData()).catch(() => undefined)}>{t("server.retry")}</Button>{status === "authenticated" ? <Button type="text" onClick={() => void useUserStore.getState().logout().catch(reportStorageError)}>{t("server.logout")}</Button> : null}</div></div> : <Spin tip={t("server.loading")}><div className="h-20 w-48" /></Spin>}
        </main>
    );
    return (
        <div className="flex h-dvh overflow-hidden bg-background text-foreground">
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
                <AppTopNav />
                <div key={dataEpoch} className="min-h-0 flex-1 overflow-hidden">{loading ? <div className="flex h-full items-center justify-center"><Spin /></div> : children}</div>
            </div>
            <AgentPanel />
        </div>
    );
}
