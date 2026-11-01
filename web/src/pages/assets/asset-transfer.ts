import { saveAs } from "file-saver";

import i18n from "@/i18n";
import { createZip, readZip } from "@/lib/zip";
import { collectClearedImageKeys, collectMediaStorageKeys, getMediaBlob, restoreMediaFiles, serializeMediaExport } from "@/services/file-storage";
import { getImageBlob } from "@/services/image-storage";
import { imageWasCleared, serverSessionSignal } from "@/services/api/server";
import type { Asset } from "@/stores/use-asset-store";

type AssetExportFile = {
    app: "infinite-canvas";
    version: 1;
    exportedAt: string;
    assets: Asset[];
    files: AssetExportItem[];
};

type AssetExportItem = {
    storageKey: string;
    path: string;
    mimeType: string;
    bytes: number;
};

export async function exportAssets(assets: Asset[], filename: string) {
    const signal = serverSessionSignal();
    const cleared = collectClearedImageKeys(assets);
    const files: AssetExportItem[] = [];
    const zipFiles: { name: string; data: BlobPart }[] = [];

    await Promise.all(
        [...collectMediaStorageKeys(assets)].map(async (storageKey) => {
            if (cleared.has(storageKey)) return;
            const blob = storageKey.startsWith("image:") ? await getImageBlob(storageKey) : await getMediaBlob(storageKey);
            if (!blob) {
                if (imageWasCleared(storageKey)) return;
                throw new Error(i18n.t("server.mediaReadFailed"));
            }
            const path = `files/${safeFileName(storageKey)}.${fileExtension(blob.type, storageKey.startsWith("image:") ? "image" : "video")}`;
            files.push({ storageKey, path, mimeType: blob.type, bytes: blob.size });
            zipFiles.push({ name: path, data: blob });
        }),
    );

    signal.throwIfAborted();
    const data: AssetExportFile = { app: "infinite-canvas", version: 1, exportedAt: new Date().toISOString(), assets: serializeMediaExport(assets), files };
    const zip = await createZip([{ name: "assets.json", data: JSON.stringify(data, null, 2) }, ...zipFiles]);
    signal.throwIfAborted();
    saveAs(zip, filename);
}

export async function readAssetPackage(file: File) {
    const signal = serverSessionSignal();
    const zip = await readZip(file);
    const assetFile = zip.get("assets.json");
    if (!assetFile) throw new Error("missing assets.json");
    const data = JSON.parse(await assetFile.text()) as AssetExportFile;
    signal.throwIfAborted();
    if (data.app !== "infinite-canvas" || data.version !== 1 || !Array.isArray(data.assets)) throw new Error("invalid asset package");
    return restoreMediaFiles(data.assets, data.files, zip);
}

function safeFileName(value: string) {
    return value.replace(/[\\/:*?"<>|]/g, "_");
}

function fileExtension(mimeType: string, kind: Asset["kind"]) {
    if (mimeType.includes("png")) return "png";
    if (mimeType.includes("jpeg")) return "jpg";
    if (mimeType.includes("webp")) return "webp";
    if (mimeType.includes("gif")) return "gif";
    if (mimeType.includes("mp4")) return "mp4";
    if (mimeType.includes("webm")) return "webm";
    return kind === "image" ? "png" : "bin";
}
