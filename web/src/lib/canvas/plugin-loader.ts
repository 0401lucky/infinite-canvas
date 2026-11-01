import { registerNodeDefinitions, unregisterPluginNodes } from "@/lib/canvas/node-registry";
import { getPluginRuntime } from "@/lib/canvas/plugin-runtime";
import { usePluginStore, type InstalledPlugin } from "@/stores/canvas/use-plugin-store";
import type { CanvasPlugin } from "@/types/canvas-plugin";
import i18n from "@/i18n";
import { serverSessionSignal } from "@/services/api/server";
import { flushServerWrites } from "@/lib/server-storage";

const cleanups = new Map<string, () => void>();

// A remote plugin may export CanvasPlugin directly or a factory that receives runtime and returns CanvasPlugin.
// The factory uses runtime.React so the bundle does not need its own React copy.
async function evaluatePluginSource(source: string, signal: AbortSignal): Promise<CanvasPlugin> {
    signal.throwIfAborted();
    const blob = new Blob([source], { type: "text/javascript" });
    const url = URL.createObjectURL(blob);
    try {
        const mod = (await import(/* @vite-ignore */ url)) as { default?: unknown; plugin?: unknown };
        signal.throwIfAborted();
        const exported = mod.default ?? mod.plugin;
        const plugin = typeof exported === "function" ? (exported as (runtime: unknown) => unknown)(getPluginRuntime()) : exported;
        assertPlugin(plugin);
        return plugin;
    } finally {
        URL.revokeObjectURL(url);
    }
}

function assertPlugin(plugin: unknown): asserts plugin is CanvasPlugin {
    const value = plugin as Partial<CanvasPlugin> | null;
    if (!value || typeof value !== "object") throw new Error(i18n.t("canvas.pluginErrors.invalidExport"));
    if (!value.id || !Array.isArray(value.nodes) || !value.nodes.length) throw new Error(i18n.t("canvas.pluginErrors.missingFields"));
}

export function activatePlugin(plugin: CanvasPlugin) {
    registerNodeDefinitions(plugin.nodes, plugin.id);
    const runtime = getPluginRuntime();
    const disposers: Array<() => void> = [];
    // Inject declared styles when enabled and remove them when disabled or uninstalled.
    if (plugin.css) disposers.push(runtime.injectCSS(plugin.css, plugin.id));
    const cleanup = plugin.setup?.(runtime);
    if (typeof cleanup === "function") disposers.push(cleanup);
    cleanups.set(plugin.id, () => disposers.forEach((dispose) => dispose()));
}

export function deactivatePlugin(pluginId: string) {
    cleanups.get(pluginId)?.();
    cleanups.delete(pluginId);
    unregisterPluginNodes(pluginId);
}

async function fetchPluginSource(url: string, signal: AbortSignal) {
    signal.throwIfAborted();
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error(i18n.t("canvas.pluginErrors.downloadFailed", { status: response.status }));
    return response.text();
}

// Add a cache-busting parameter so watch builds load the latest output.
function withCacheBust(url: string) {
    return `${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}`;
}

// Install or replace a plugin from a URL and enable it immediately.
// bustCache bypasses HTTP/CDN caches during upgrades while persisting a clean URL without the timestamp query.
export async function installPluginFromUrl(url: string, opts?: { official?: boolean; bustCache?: boolean }) {
    const signal = serverSessionSignal();
    const source = await fetchPluginSource(opts?.bustCache ? withCacheBust(url) : url, signal);
    const plugin = await evaluatePluginSource(source, signal);
    signal.throwIfAborted();
    deactivatePlugin(plugin.id); // Replace the previous version.
    usePluginStore.getState().upsert({ id: plugin.id, name: plugin.name || plugin.id, version: plugin.version || "0.0.0", description: plugin.description, url, source, enabled: true, official: opts?.official });
    activatePlugin(plugin);
    await flushServerWrites();
    signal.throwIfAborted();
    return plugin;
}

export async function updatePlugin(record: InstalledPlugin) {
    // Upgrades must fetch the latest output and therefore always bypass caches.
    return installPluginFromUrl(record.url, { official: record.official, bustCache: true });
}

export async function setPluginEnabled(record: InstalledPlugin, enabled: boolean) {
    const signal = serverSessionSignal();
    signal.throwIfAborted();
    if (!enabled) {
        usePluginStore.getState().setEnabled(record.id, false);
        deactivatePlugin(record.id);
        await flushServerWrites();
        signal.throwIfAborted();
        return;
    }
    // Reload local plugins from their URL when enabled because the cached source may be stale.
    const source = record.local ? await fetchPluginSource(withCacheBust(record.url), signal) : record.source;
    const plugin = await evaluatePluginSource(source, signal);
    signal.throwIfAborted();
    usePluginStore.getState().setEnabled(record.id, true);
    activatePlugin(plugin);
    await flushServerWrites();
    signal.throwIfAborted();
}

export async function uninstallPlugin(id: string) {
    const signal = serverSessionSignal();
    signal.throwIfAborted();
    deactivatePlugin(id);
    usePluginStore.getState().remove(id);
    await flushServerWrites();
    signal.throwIfAborted();
}

let loaded = false;

export function resetPlugins() {
    for (const pluginId of cleanups.keys()) deactivatePlugin(pluginId);
    loaded = false;
}

// Load installed and enabled plugins at application startup.
export async function ensurePluginsLoaded() {
    if (loaded) return;
    const signal = serverSessionSignal();
    signal.throwIfAborted();
    loaded = true;
    await loadLocalPlugins(signal); // Discover disabled local plugins first, then activate all enabled records.
    signal.throwIfAborted();
    const records = usePluginStore.getState().plugins.filter((record) => record.enabled);
    await Promise.all(
        records.map(async (record) => {
            try {
                // Local plugins use the latest output; other plugins use their cached source.
                const source = record.local ? await fetchPluginSource(withCacheBust(record.url), signal) : record.source;
                const plugin = await evaluatePluginSource(source, signal);
                signal.throwIfAborted();
                activatePlugin(plugin);
            } catch (error) {
                signal.throwIfAborted();
                console.error(`[plugin] Failed to load: ${record.id}`, error);
            }
        }),
    );
    signal.throwIfAborted();
    await loadDevPlugins(signal);
}

// Discover local plugins from web/public/plugins, add them disabled, and expose them in the manager without a URL.
// Refresh metadata and source for existing records while preserving the enabled flag so persisted versions stay current.
async function loadLocalPlugins(signal: AbortSignal) {
    let urls: unknown;
    try {
        const response = await fetch("/plugins/index.json", { signal });
        if (!response.ok) return;
        urls = await response.json();
    } catch {
        signal.throwIfAborted();
        return; // Skip when no local manifest exists, such as production builds without plugins.
    }
    signal.throwIfAborted();
    if (!Array.isArray(urls) || !urls.length) return;
    const store = usePluginStore.getState();
    await Promise.all(
        urls.map(async (url: string) => {
            try {
                const source = await fetchPluginSource(withCacheBust(url), signal);
                const plugin = await evaluatePluginSource(source, signal);
                signal.throwIfAborted();
                const existing = store.plugins.find((item) => item.id === plugin.id);
                store.upsert({
                    id: plugin.id,
                    name: plugin.name || plugin.id,
                    version: plugin.version || "0.0.0",
                    description: plugin.description,
                    url,
                    source,
                    enabled: existing?.enabled ?? false, // Preserve the user setting; new discoveries default to disabled.
                    local: true,
                });
            } catch (error) {
                signal.throwIfAborted();
                console.error(`[plugin] Failed to discover local plugin: ${url}`, error);
            }
        }),
    );
}

// During local development, refetch VITE_DEV_PLUGINS URLs without caching or persistence on every startup.
// Together with watch builds, refreshing the page loads code changes without reinstalling the plugin.
async function loadDevPlugins(signal: AbortSignal) {
    const raw = import.meta.env.VITE_DEV_PLUGINS;
    if (!raw) return;
    const urls = raw.split(",").map((item) => item.trim()).filter(Boolean);
    await Promise.all(
        urls.map(async (url) => {
            try {
                const source = await fetchPluginSource(withCacheBust(url), signal);
                const plugin = await evaluatePluginSource(source, signal);
                signal.throwIfAborted();
                deactivatePlugin(plugin.id);
                activatePlugin(plugin);
                console.info(`[plugin] Dev plugin loaded: ${plugin.id} (${url})`);
            } catch (error) {
                signal.throwIfAborted();
                console.error(`[plugin] Failed to load dev plugin: ${url}`, error);
            }
        }),
    );
}
