import { create } from "zustand";
import i18n from "@/i18n";
import { allowServerWrites, clearServerImages, flushServerTasks, loginServer, logoutServer, readServerSession, refreshServerMedia, resetServerSession, serverSessionSignal, type AdminUser } from "@/services/api/server";
import { flushServerWrites } from "@/lib/server-storage";
import { queryClient } from "@/lib/query-client";
import { resetPlugins } from "@/lib/canvas/plugin-loader";
import { clearImageCaches } from "@/services/image-storage";
import { clearMediaCaches } from "@/services/file-storage";
import { clearVideoTaskResults } from "@/services/api/video";
import { clearWebdavCache } from "@/services/webdav-sync";
import { resetPromptRefreshes } from "@/services/api/prompts";
import { useConfigStore } from "@/stores/use-config-store";
import { usePromptSourceStore } from "@/stores/use-prompt-source-store";
import { useAssetStore } from "@/stores/use-asset-store";
import { useAgentStore } from "@/stores/use-agent-store";
import { useWorkbenchAgentStore } from "@/stores/use-workbench-agent-store";
import { usePluginStore } from "@/stores/canvas/use-plugin-store";
import { discardCanvasSave, flushCanvasSave, useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useStorageStore } from "@/stores/use-storage-store";

type UserStore = {
    user: AdminUser | null;
    status: "checking" | "anonymous" | "authenticated" | "error";
    ready: boolean;
    loading: boolean;
    error: string;
    dataEpoch: number;
    restoreSession: () => Promise<void>;
    login: (username: string, password: string) => Promise<void>;
    logout: () => Promise<void>;
    reloadData: () => Promise<void>;
    clearImages: () => Promise<void>;
    clearSession: () => void;
};

let generation = 0;
let restoring: Promise<void> | null = null;
let loading: Promise<void> | null = null;
const persistedStores = [useConfigStore, usePromptSourceStore, useCanvasStore, useAssetStore, usePluginStore];

function resetBusinessState() {
    discardCanvasSave();
    resetPlugins();
    resetPromptRefreshes();
    clearImageCaches();
    clearMediaCaches();
    clearVideoTaskResults();
    clearWebdavCache();
    useConfigStore.setState(useConfigStore.getInitialState(), true);
    usePromptSourceStore.setState(usePromptSourceStore.getInitialState(), true);
    useCanvasStore.setState(useCanvasStore.getInitialState(), true);
    useAssetStore.setState(useAssetStore.getInitialState(), true);
    usePluginStore.setState(usePluginStore.getInitialState(), true);
}

export async function flushAppStorage() {
    await flushCanvasSave();
    await flushServerWrites();
    await flushServerTasks();
    await flushServerWrites();
}

function loadData() {
    if (loading) return loading;
    const current = ++generation;
    resetServerSession(true);
    void queryClient.cancelQueries();
    queryClient.clear();
    resetBusinessState();
    useUserStore.setState({ ready: false, loading: true, error: "" });
    const job = (async () => {
        try {
            await refreshServerMedia();
            if (current !== generation) throw new DOMException("Session ended", "AbortError");
            await Promise.all(persistedStores.map((store) => store.persist.rehydrate()));
            if (current !== generation) throw new DOMException("Session ended", "AbortError");
            if (persistedStores.some((store) => !store.getState().hydrated)) throw new Error(useStorageStore.getState().error || i18n.t("server.loadFailed"));
            allowServerWrites(true);
            useUserStore.setState((state) => ({ ready: true, loading: false, dataEpoch: state.dataEpoch + 1 }));
        } catch (error) {
            if (current === generation) useUserStore.setState({ loading: false, ready: false, error: error instanceof Error ? error.message : i18n.t("server.loadFailed") });
            throw error;
        } finally { if (loading === job) loading = null; }
    })();
    loading = job;
    return job;
}

export const useUserStore = create<UserStore>()((set) => ({
    user: null,
    status: "checking",
    ready: false,
    loading: false,
    error: "",
    dataEpoch: 0,
    restoreSession: () => {
        if (restoring) return restoring;
        set({ status: "checking", error: "" });
        const current = generation;
        const job = (async () => {
            try {
                const { user } = await readServerSession();
                if (current !== generation) return;
                set({ user, status: user ? "authenticated" : "anonymous" });
                if (user) await loadData();
            } catch (error) {
                if (current === generation && !useUserStore.getState().user) set({ status: "error", error: error instanceof Error ? error.message : i18n.t("server.unavailable") });
            } finally { if (restoring === job) restoring = null; }
        })();
        restoring = job;
        return job;
    },
    login: async (username, password) => {
        const current = generation;
        set({ loading: true, error: "" });
        try {
            const { user } = await loginServer(username, password);
            if (current !== generation) return;
            set({ user, status: "authenticated" });
            await loadData();
        } catch (error) {
            if (current === generation) set({ loading: false, error: error instanceof Error ? error.message : i18n.t("server.unavailable") });
            throw error;
        }
    },
    logout: async () => {
        const signal = serverSessionSignal();
        await flushAppStorage();
        signal.throwIfAborted();
        await logoutServer();
        signal.throwIfAborted();
        useUserStore.getState().clearSession();
    },
    reloadData: loadData,
    clearImages: async () => {
        const signal = serverSessionSignal();
        await flushAppStorage();
        signal.throwIfAborted();
        allowServerWrites(false);
        try { await clearServerImages(); }
        finally { if (!signal.aborted && useUserStore.getState().user) await loadData(); }
    },
    clearSession: () => {
        generation += 1;
        restoring = null;
        loading = null;
        resetServerSession();
        void queryClient.cancelQueries();
        queryClient.clear();
        resetBusinessState();
        useWorkbenchAgentStore.setState(useWorkbenchAgentStore.getInitialState(), true);
        useAgentStore.getState().disconnectAgent({ messages: [], threads: [], attachments: [], canvasReferences: [], activeThreadId: "", activeTurnId: "", prompt: "" });
        set({ user: null, status: "anonymous", ready: false, loading: false, error: "" });
    },
}));
