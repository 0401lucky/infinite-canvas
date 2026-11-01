import type { StateStorage } from "zustand/middleware";

import { canWriteServerStorage, readServerRecord, readServerRecords, replaceServerRecords, serverSessionEpoch, serverSessionSignal, writeServerRecord, type ServerRecord, type ServerRecords } from "@/services/api/server";
import { acknowledgeStorageWrite, reportStorageError, useStorageStore } from "@/stores/use-storage-store";

const stores = new Map<string, ReturnType<typeof makeStore>>();
const queues = new Map<string, Promise<unknown>>();

function enqueue<T>(id: string, write: boolean, operation: () => Promise<T>) {
    const epoch = serverSessionEpoch();
    const job = (queues.get(id) || Promise.resolve()).catch(() => undefined).then(async () => {
        if (epoch !== serverSessionEpoch()) throw new DOMException("Session ended", "AbortError");
        if (write && !canWriteServerStorage()) throw new DOMException("Storage is not ready", "AbortError");
        if (write) useStorageStore.setState((state) => ({ pending: state.pending + 1 }));
        try {
            const result = await operation();
            if (epoch !== serverSessionEpoch()) throw new DOMException("Session ended", "AbortError");
            if (write) acknowledgeStorageWrite(id);
            return result;
        } catch (error) {
            if (epoch === serverSessionEpoch()) reportStorageError(error, write ? id : undefined);
            throw error;
        } finally {
            if (write && epoch === serverSessionEpoch()) useStorageStore.setState((state) => ({ pending: state.pending - 1 }));
        }
    });
    queues.set(id, job);
    const remove = () => { if (queues.get(id) === job) queues.delete(id); };
    void job.then(remove, remove);
    return job;
}

function makeStore(namespace: string) {
    const revisions = new Map<string, number>();
    let epoch = serverSessionEpoch();
    const reset = () => {
        if (epoch === serverSessionEpoch()) return;
        epoch = serverSessionEpoch();
        revisions.clear();
    };
    const remember = (record: ServerRecord) => { revisions.set(record.key, record.revision); return record; };
    const rememberAll = (result: ServerRecords) => { result.records.forEach(remember); return result; };
    const id = (key: string) => `${namespace}/${key}`;
    const waitWrites = () => Promise.all([...queues].filter(([key]) => key.startsWith(`${namespace}/`)).map(([, job]) => job));
    const readAll = async () => {
        const signal = serverSessionSignal();
        reset();
        await waitWrites();
        signal.throwIfAborted();
        try {
            const result = await readServerRecords(namespace);
            signal.throwIfAborted();
            return rememberAll(result);
        }
        catch (error) { reportStorageError(error); throw error; }
    };
    return {
        snapshot: readAll,
        getItem: <T = unknown>(key: string) => enqueue(id(key), false, async () => {
            const signal = serverSessionSignal();
            reset();
            const record = await readServerRecord(namespace, key);
            signal.throwIfAborted();
            return remember(record).value as T | null;
        }),
        setItem: <T>(key: string, value: T) => enqueue(id(key), true, async () => {
            const signal = serverSessionSignal();
            reset();
            if (!revisions.has(key)) {
                const record = await readServerRecord(namespace, key);
                signal.throwIfAborted();
                remember(record);
            }
            const record = await writeServerRecord(namespace, key, value, revisions.get(key)!);
            signal.throwIfAborted();
            return remember(record).value as T;
        }),
        removeItem: (key: string) => enqueue(id(key), true, async () => {
            const signal = serverSessionSignal();
            reset();
            if (!revisions.has(key)) {
                const record = await readServerRecord(namespace, key);
                signal.throwIfAborted();
                remember(record);
            }
            const record = await writeServerRecord(namespace, key, null, revisions.get(key)!, true);
            signal.throwIfAborted();
            remember(record);
        }),
        iterate: async <T, R>(iterator: (value: T, key: string, iteration: number) => R) => {
            const result = await readAll();
            let index = 0;
            for (const item of result.records) {
                if (item.deleted) continue;
                const value = iterator(item.value as T, item.key, ++index);
                if (value !== undefined) return value;
            }
            return undefined;
        },
        replace: async (items: Array<{ key: string; value: unknown }>, revision: number) => {
            const signal = serverSessionSignal();
            reset();
            await waitWrites();
            signal.throwIfAborted();
            return enqueue(id(""), true, async () => {
                signal.throwIfAborted();
                const result = await replaceServerRecords(namespace, items, revision);
                signal.throwIfAborted();
                return rememberAll(result);
            });
        },
    };
}

export function createServerRecordStorage(namespace: string) {
    let store = stores.get(namespace);
    if (!store) { store = makeStore(namespace); stores.set(namespace, store); }
    return store;
}

const appState = createServerRecordStorage("app_state");
export const serverStateStorage: StateStorage = {
    getItem: async (key) => {
        const signal = serverSessionSignal();
        const value = await appState.getItem(key);
        signal.throwIfAborted();
        return value === null ? null : JSON.stringify(value);
    },
    setItem: async (key, value) => {
        if (!canWriteServerStorage()) return;
        await appState.setItem(key, JSON.parse(value)).catch(() => undefined);
    },
    removeItem: async (key) => { if (canWriteServerStorage()) await appState.removeItem(key).catch(() => undefined); },
};

export async function flushServerWrites() {
    while (queues.size) await Promise.all([...queues.values()]);
    const failed = Object.values(useStorageStore.getState().failedWrites)[0];
    if (failed) throw new Error(failed);
}
