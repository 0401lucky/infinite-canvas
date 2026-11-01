import { create } from "zustand";

type StorageState = {
    pending: number;
    canvasQueued: boolean;
    error: string;
    errorId: number;
    failedWrites: Record<string, string>;
    sessionExpired: boolean;
};

export const useStorageStore = create<StorageState>(() => ({ pending: 0, canvasQueued: false, error: "", errorId: 0, failedWrites: {}, sessionExpired: false }));

export function reportStorageError(reason: unknown, key?: string) {
    if (reason instanceof DOMException && reason.name === "AbortError") return;
    const error = reason instanceof Error ? reason.message : String(reason);
    useStorageStore.setState((state) => ({ error, errorId: state.errorId + 1, failedWrites: key ? { ...state.failedWrites, [key]: error } : state.failedWrites }));
}

export function acknowledgeStorageWrite(key: string) {
    const { [key]: _removed, ...failedWrites } = useStorageStore.getState().failedWrites;
    useStorageStore.setState({ failedWrites, error: Object.values(failedWrites).at(-1) || "" });
}
