import type { StateStorage } from "zustand/middleware";

import { canWriteServerStorage, readServerRecord, readServerRecords, replaceServerRecords, serverSessionEpoch, serverSessionSignal, writeServerRecord, type ServerRecord, type ServerRecords } from "@/services/api/server";
import { acknowledgeStorageWrite, reportStorageError, useStorageStore } from "@/stores/use-storage-store";

const stores = new Map<string, ReturnType<typeof makeStore>>();
const queues = new Map<string, Map<string, Promise<unknown>>>();
let queuesEpoch = serverSessionEpoch();

function resetQueues() {
    const epoch = serverSessionEpoch();
    if (queuesEpoch !== epoch) { queues.clear(); queuesEpoch = epoch; }
    return epoch;
}

function enqueue<T>(namespace: string, key: string, write: boolean, operation: () => Promise<T>) {
    const epoch = resetQueues();
    const queue = queues.get(namespace) || new Map<string, Promise<unknown>>();
    queues.set(namespace, queue);
    const id = `${namespace}/${key}`;
    // The empty key is a collection barrier; unrelated record keys stay parallel.
    const previous = key ? [queue.get(key), queue.get("")] : [...queue.values()];
    if (write) useStorageStore.setState((state) => ({ pending: state.pending + 1 }));
    const job = Promise.all(previous.map((task) => task?.catch(() => undefined))).then(async () => {
        if (epoch !== serverSessionEpoch()) throw new DOMException("Session ended", "AbortError");
        if (write && !canWriteServerStorage()) throw new DOMException("Storage is not ready", "AbortError");
        try {
            const result = await operation();
            if (epoch !== serverSessionEpoch()) throw new DOMException("Session ended", "AbortError");
            if (write) acknowledgeStorageWrite(id);
            return result;
        } catch (error) {
            if (epoch === serverSessionEpoch()) reportStorageError(error, write ? id : undefined);
            throw error;
        }
    }).finally(() => {
        if (write && epoch === serverSessionEpoch()) useStorageStore.setState((state) => ({ pending: state.pending - 1 }));
    });
    queue.set(key, job);
    const remove = () => {
        if (queue.get(key) === job) queue.delete(key);
        if (!queue.size && queues.get(namespace) === queue) queues.delete(namespace);
    };
    void job.then(remove, remove);
    return job;
}

function makeStore(namespace: string) {
    const revisions = new Map<string, number>();
    const listeners = new Set<() => void>();
    let collectionVersion = 0;
    let epoch = serverSessionEpoch();
    const reset = () => {
        if (epoch === serverSessionEpoch()) return;
        epoch = serverSessionEpoch();
        revisions.clear();
    };
    const remember = (record: ServerRecord) => { revisions.set(record.key, record.revision); return record; };
    const rememberAll = (result: ServerRecords) => { result.records.forEach(remember); return result; };
    const readAll = () => enqueue(namespace, "", false, async () => {
        const signal = serverSessionSignal();
        reset();
        const result = await readServerRecords(namespace);
        signal.throwIfAborted();
        return rememberAll(result);
    });
    return {
        subscribe: (listener: () => void) => {
            listeners.add(listener);
            return () => { listeners.delete(listener); };
        },
        getSnapshot: () => collectionVersion,
        snapshot: readAll,
        getItem: <T = unknown>(key: string) => enqueue(namespace, key, false, async () => {
            const signal = serverSessionSignal();
            reset();
            const record = await readServerRecord(namespace, key);
            signal.throwIfAborted();
            return remember(record).value as T | null;
        }),
        setItem: <T>(key: string, value: T) => enqueue(namespace, key, true, async () => {
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
        removeItem: (key: string) => enqueue(namespace, key, true, async () => {
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
        replace: (items: Array<{ key: string; value: unknown }>, revision: number) => enqueue(namespace, "", true, async () => {
            const signal = serverSessionSignal();
            reset();
            const result = await replaceServerRecords(namespace, items, revision);
            signal.throwIfAborted();
            rememberAll(result);
            collectionVersion += 1;
            // UI listeners must not turn a committed replacement into a failed save.
            for (const listener of listeners) queueMicrotask(() => { if (listeners.has(listener) && !signal.aborted) listener(); });
            return result;
        }),
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
    const epoch = resetQueues();
    while (queues.size) {
        await Promise.all([...queues.values()].flatMap((queue) => [...queue.values()]));
        if (epoch !== serverSessionEpoch()) throw new DOMException("Session ended", "AbortError");
    }
    const failed = Object.values(useStorageStore.getState().failedWrites)[0];
    if (failed) throw new Error(failed);
}
