import { afterAll, afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";

const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => null, setItem: () => undefined } });
afterAll(() => {
    if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
    else Reflect.deleteProperty(globalThis, "localStorage");
});

const { createServerRecordStorage, flushServerWrites } = await import("../src/lib/server-storage");
const { allowServerWrites, resetServerSession } = await import("../src/services/api/server");
const { useStorageStore } = await import("../src/stores/use-storage-store");
type Store = ReturnType<typeof createServerRecordStorage>;
type PendingRequest = { path: string; init: RequestInit; resolve: (response: Response) => void };
let calls: PendingRequest[] = [];
let incoming: PendingRequest[] = [];
let waiting: Array<(request: PendingRequest) => void> = [];
let subscriptions: Array<() => void> = [];
let storeId = 0;
const storeForTest = () => createServerRecordStorage(`plugin:storage-test-${++storeId}`);
const record = (key: string, value: unknown, revision: number) => ({ key, value, revision });
const reply = (request: PendingRequest, data: unknown) => request.resolve(new Response(JSON.stringify({ data }), { headers: { "Content-Type": "application/json" } }));
const conflict = (request: PendingRequest) => request.resolve(new Response(JSON.stringify({ error: { code: "STORAGE_CONFLICT", message: "Version conflict" } }), { status: 409 }));
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
const nextRequest = () => {
    const request = incoming.shift();
    return request ? Promise.resolve(request) : new Promise<PendingRequest>((resolve) => waiting.push(resolve));
};
const revisionOf = (request: PendingRequest) => new Headers(request.init.headers).get("If-Match");
async function prime(store: Store) {
    const read = store.getItem("record");
    reply(await nextRequest(), record("record", "saved", 1));
    await read;
}

beforeEach(() => {
    calls = []; incoming = []; waiting = []; subscriptions = [];
    resetServerSession("test-user");
    allowServerWrites(true);
    spyOn(globalThis, "fetch").mockImplementation((input, init) => new Promise<Response>((resolve) => {
        const request = { path: String(input), init: init || {}, resolve };
        calls.push(request);
        const waiter = waiting.shift();
        if (waiter) waiter(request);
        else incoming.push(request);
    }));
});
afterEach(async () => {
    subscriptions.forEach((unsubscribe) => unsubscribe());
    resetServerSession();
    calls.forEach((request) => reply(request, null));
    await settle();
    mock.restore();
});

test("a collection read cannot race with later writes and roll their revisions back", async () => {
    const store = storeForTest();
    await prime(store);
    const snapshot = store.snapshot();
    const read = await nextRequest();
    const write = store.setItem("record", "new");
    await settle();
    expect(calls).toHaveLength(2);
    expect(useStorageStore.getState().pending).toBe(1);

    reply(read, { revision: 1, records: [record("record", "saved", 1)] });
    await snapshot;
    const first = await nextRequest();
    expect(first.init.method).toBe("PUT");
    expect(revisionOf(first)).toBe("1");
    reply(first, record("record", "new", 2));
    await write;

    const later = store.setItem("record", "newer");
    const second = await nextRequest();
    expect(revisionOf(second)).toBe("2");
    reply(second, record("record", "newer", 3));
    await later;
});

test("a replacement waiting on a write is already a barrier for subsequent writes", async () => {
    const store = storeForTest();
    await prime(store);
    const earlier = store.setItem("record", "earlier");
    const first = await nextRequest();
    const replacement = store.replace([{ key: "record", value: "replacement" }], 2);
    const later = store.setItem("record", "latest");
    await settle();
    expect(calls).toHaveLength(2);

    reply(first, record("record", "earlier", 2));
    const replace = await nextRequest();
    expect(replace.path.endsWith("/record")).toBe(false);
    expect(revisionOf(replace)).toBe("2");
    reply(replace, { revision: 3, records: [record("record", "replacement", 3)] });
    const last = await nextRequest();
    expect(last.path.endsWith("/record")).toBe(true);
    expect(revisionOf(last)).toBe("3");
    reply(last, record("record", "latest", 4));
    await Promise.all([earlier, replacement, later]);
});

test("different keys remain parallel but a snapshot waits for every earlier write", async () => {
    const store = storeForTest();
    const writes = [store.setItem("a", "A"), store.setItem("b", "B")];
    const reads = [await nextRequest(), await nextRequest()];
    expect(calls).toHaveLength(2);
    for (const read of reads) reply(read, record(read.path.endsWith("/a") ? "a" : "b", null, 0));
    const puts = [await nextRequest(), await nextRequest()];
    const snapshot = store.snapshot();
    await settle();
    expect(calls).toHaveLength(4);
    reply(puts[0], record(puts[0].path.endsWith("/a") ? "a" : "b", "saved", 1));
    await settle();
    expect(calls).toHaveLength(4);
    reply(puts[1], record(puts[1].path.endsWith("/a") ? "a" : "b", "saved", 1));
    reply(await nextRequest(), { revision: 2, records: [record("a", "A", 1), record("b", "B", 1)] });
    await Promise.all([...writes, snapshot]);
});

test("a collection barrier does not block another namespace", async () => {
    const snapshot = storeForTest().snapshot();
    const blocked = await nextRequest();
    const other = storeForTest().setItem("record", "other");
    reply(await nextRequest(), record("record", null, 0));
    const put = await nextRequest();
    expect(put.init.method).toBe("PUT");
    reply(put, record("record", "other", 1));
    await other;
    reply(blocked, { revision: 0, records: [] });
    await snapshot;
});

test("a true conflict keeps failed-save state and never fetches a new revision to retry", async () => {
    const store = storeForTest();
    await prime(store);
    const write = store.setItem("record", "unsaved");
    const first = await nextRequest();
    expect(revisionOf(first)).toBe("1");
    conflict(first);
    await expect(write).rejects.toMatchObject({ code: "STORAGE_CONFLICT" });
    expect(Object.values(useStorageStore.getState().failedWrites)).toHaveLength(1);
    await expect(flushServerWrites()).rejects.toBeInstanceOf(Error);
    expect(useStorageStore.getState().error).not.toContain("\u5176\u4ed6\u9875\u9762");

    const later = store.setItem("record", "still unsaved");
    const second = await nextRequest();
    expect(second.init.method).toBe("PUT");
    expect(revisionOf(second)).toBe("1");
    conflict(second);
    await expect(later).rejects.toMatchObject({ code: "STORAGE_CONFLICT" });
    expect(calls).toHaveLength(3);
});

test("successful replacement publishes a local update and remembers versions before later saves", async () => {
    const store = storeForTest();
    const version = store.getSnapshot();
    const updates: number[] = [];
    const unsubscribe = store.subscribe(() => { updates.push(store.getSnapshot()); });
    subscriptions.push(unsubscribe);
    const replacement = store.replace([{ key: "record", value: "imported" }], 0);
    reply(await nextRequest(), { revision: 1, records: [record("record", "imported", 1)] });
    await replacement;
    await settle();
    expect(updates).toEqual([version + 1]);

    const write = store.setItem("record", "edited");
    const put = await nextRequest();
    expect(revisionOf(put)).toBe("1");
    reply(put, record("record", "edited", 2));
    await write;
    expect(store.getSnapshot()).toBe(version + 1);
    unsubscribe();
    const again = store.replace([{ key: "record", value: "second import" }], 2);
    reply(await nextRequest(), { revision: 3, records: [record("record", "second import", 3)] });
    await again;
    await settle();
    expect(updates).toEqual([version + 1]);
    expect(store.getSnapshot()).toBe(version + 2);
});

test("a failed replacement does not notify history subscribers", async () => {
    const store = storeForTest();
    const version = store.getSnapshot();
    const listener = mock(() => undefined);
    subscriptions.push(store.subscribe(listener));
    const replacement = store.replace([], 0);
    conflict(await nextRequest());
    await expect(replacement).rejects.toMatchObject({ code: "STORAGE_CONFLICT" });
    await settle();
    expect(listener).not.toHaveBeenCalled();
    expect(store.getSnapshot()).toBe(version);
});

test("a new session is independent of old queues and ignores their delayed responses", async () => {
    const store = storeForTest();
    const oldRead = store.snapshot();
    const oldRequest = await nextRequest();
    const oldWrite = store.setItem("record", "old user");
    resetServerSession("new-user");
    allowServerWrites(true);
    const currentRead = store.snapshot();
    const currentRequest = await nextRequest();
    expect(new Headers(currentRequest.init.headers).get("X-Canvas-User")).toBe("new-user");
    reply(currentRequest, { revision: 7, records: [record("record", "new user", 7)] });
    await currentRead;
    reply(oldRequest, { revision: 1, records: [record("record", "old user", 1)] });
    await expect(oldRead).rejects.toMatchObject({ name: "AbortError" });
    await expect(oldWrite).rejects.toMatchObject({ name: "AbortError" });

    const write = store.setItem("record", "current edit");
    const put = await nextRequest();
    expect(revisionOf(put)).toBe("7");
    expect(new Headers(put.init.headers).get("X-Canvas-User")).toBe("new-user");
    reply(put, record("record", "current edit", 8));
    await write;
    expect(calls).toHaveLength(3);
    expect(useStorageStore.getState().pending).toBe(0);
    expect(useStorageStore.getState().failedWrites).toEqual({});
});
