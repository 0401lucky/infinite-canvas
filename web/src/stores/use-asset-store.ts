import { create } from "zustand";
import { persist, type PersistStorage, type StorageValue } from "zustand/middleware";

import { nanoid } from "nanoid";
import { flushServerWrites, serverStateStorage } from "@/lib/server-storage";
import { cleanupUnusedImages, ensureImagePreview, previewUrlFor, resolveImageUrl } from "@/services/image-storage";
import { cleanupUnusedMedia, resolveMediaUrl } from "@/services/file-storage";
import { imageWasCleared, serverSessionEpoch, serverSessionSignal } from "@/services/api/server";
import { reportStorageError } from "@/stores/use-storage-store";

export type AssetKind = "text" | "image" | "video";
export type TextAsset = AssetBase<"text"> & { data: { content: string } };
export type ImageAsset = AssetBase<"image"> & { data: { dataUrl: string; storageKey?: string; width: number; height: number; bytes: number; mimeType: string; cleared?: boolean } };
export type VideoAsset = AssetBase<"video"> & { data: { url: string; storageKey?: string; width: number; height: number; bytes: number; mimeType: string } };
export type Asset = TextAsset | ImageAsset | VideoAsset;

type AssetBase<T extends AssetKind> = {
    id: string;
    kind: T;
    title: string;
    coverUrl: string;
    coverStorageKey?: string;
    coverCleared?: boolean;
    tags: string[];
    source?: string;
    note?: string;
    createdAt: string;
    updatedAt: string;
    metadata?: Record<string, unknown>;
};

type AssetStore = {
    hydrated: boolean;
    assets: Asset[];
    addAsset: (asset: Omit<Asset, "id" | "createdAt" | "updatedAt">) => string;
    updateAsset: (id: string, patch: Partial<Omit<Asset, "id" | "createdAt">>) => void;
    removeAsset: (id: string) => void;
    replaceAssets: (assets: Asset[]) => void;
    cleanupImages: (extra?: unknown) => void;
};

// 卡片用缩略图渲染，自定义封面（远程地址或单独上传的封面）保持原样。
export function assetCoverUrl(asset: Asset) {
    const own = asset.kind === "image" ? asset.data.dataUrl : "";
    const cover = asset.coverUrl || own;
    if (asset.coverCleared || imageWasCleared(asset.coverStorageKey) || (asset.kind === "image" && (asset.data.cleared || imageWasCleared(asset.data.storageKey)))) return "";
    return previewUrlFor(asset.coverStorageKey) || (asset.kind === "image" && cover === own ? previewUrlFor(asset.data.storageKey) || cover : cover);
}

const ASSET_STORE_KEY = "infinite-canvas:asset_store";

const assetStorage: PersistStorage<AssetStore> = {
    getItem: async (name) => {
        const signal = serverSessionSignal();
        const value = await serverStateStorage.getItem(name);
        signal.throwIfAborted();
        if (!value) return null;
        const parsed = JSON.parse(value) as StorageValue<AssetStore>;
        parsed.state.assets = await Promise.all(
            parsed.state.assets.map(async (asset) => {
                if (asset.coverStorageKey) asset = { ...asset, coverUrl: await resolveImageUrl(asset.coverStorageKey, asset.coverUrl) };
                if (asset.kind === "video" && asset.data.storageKey) return { ...asset, data: { ...asset.data, url: await resolveMediaUrl(asset.data.storageKey, asset.data.url) } };
                if (asset.kind !== "image") return asset;
                if (asset.data.storageKey) {
                    void ensureImagePreview(asset.data.storageKey);
                    return {
                        ...asset,
                        coverUrl: asset.coverUrl.startsWith("blob:") ? await resolveImageUrl(asset.data.storageKey, asset.coverUrl) : asset.coverUrl,
                        data: { ...asset.data, dataUrl: await resolveImageUrl(asset.data.storageKey, asset.data.dataUrl) },
                    };
                }
                return asset;
            }),
        );
        signal.throwIfAborted();
        return parsed;
    },
    setItem: (name, value) => serverStateStorage.setItem(name, JSON.stringify(value)),
    removeItem: (name) => serverStateStorage.removeItem(name),
};

export const useAssetStore = create<AssetStore>()(
    persist(
        (set, get) => ({
            hydrated: false,
            assets: [],
            addAsset: (asset) => {
                const now = new Date().toISOString();
                const id = nanoid();
                set((state) => ({ assets: [{ ...asset, id, createdAt: now, updatedAt: now } as Asset, ...state.assets] }));
                return id;
            },
            updateAsset: (id, patch) =>
                set((state) => ({
                    assets: state.assets.map((asset) => (asset.id === id ? ({ ...asset, ...patch, updatedAt: new Date().toISOString() } as Asset) : asset)),
                })),
            removeAsset: (id) =>
                set((state) => {
                    const assets = state.assets.filter((asset) => asset.id !== id);
                    get().cleanupImages({ assets });
                    return { assets };
                }),
            replaceAssets: (assets) => set({ assets }),
            cleanupImages: (extra) => {
                const epoch = serverSessionEpoch();
                const signal = serverSessionSignal();
                window.setTimeout(async () => {
                    if (signal.aborted) return;
                    try {
                        await flushServerWrites();
                        signal.throwIfAborted();
                        const { useCanvasStore } = await import("@/stores/canvas/use-canvas-store");
                        if (epoch !== serverSessionEpoch()) return;
                        await cleanupUnusedImages({ assets: get().assets, projects: useCanvasStore.getState().projects, extra });
                        signal.throwIfAborted();
                        await cleanupUnusedMedia({ assets: get().assets, projects: useCanvasStore.getState().projects, extra });
                    } catch (error) { reportStorageError(error); }
                }, 0);
            },
        }),
        {
            name: ASSET_STORE_KEY,
            storage: assetStorage,
            skipHydration: true,
            partialize: (state) => ({ assets: state.assets }) as StorageValue<AssetStore>["state"],
            onRehydrateStorage: () => {
                const epoch = serverSessionEpoch();
                return (_state, error) => {
                    if (epoch === serverSessionEpoch()) useAssetStore.setState({ hydrated: !error });
                };
            },
        },
    ),
);
