import { Button, Drawer, Input, Modal, Segmented, Select, Space } from "antd";
import { ListPlus, Plus, Trash2 } from "lucide-react";
import { nanoid } from "nanoid";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { AGNES_BASE_URL, AGNES_FLASH_MODELS, defaultBaseUrlForApiFormat, guessCapability, normalizeChannelApiKeys, normalizeChannelModels, type ApiCallFormat, type ApiKeyMode, type ChannelModel, type ModelCapability, type ModelChannel } from "@/stores/use-config-store";
import { ModelScriptEditor } from "./model-script-editor";
import { ModelSelectModal } from "./model-select-modal";

type ScriptTarget = { name: string; capability: ModelCapability; value: string };

export function ChannelEditorDrawer({ open, channel, onSave, onClose }: { open: boolean; channel: ModelChannel | null; onSave: (channel: ModelChannel) => void; onClose: () => void }) {
    const { t } = useTranslation();
    const [draft, setDraft] = useState<ModelChannel | null>(channel);
    const [selectOpen, setSelectOpen] = useState(false);
    const [bulkOpen, setBulkOpen] = useState(false);
    const [bulkKeys, setBulkKeys] = useState("");
    const [scriptTarget, setScriptTarget] = useState<ScriptTarget | null>(null);
    const apiFormatOptions: Array<{ label: string; value: ApiCallFormat }> = [
        { label: "OpenAI", value: "openai" },
        { label: "Gemini", value: "gemini" },
        { label: t("config.channels.agnes"), value: "agnes" },
    ];
    const capabilityOptions: Array<{ label: string; value: ModelCapability }> = ["image", "video", "text", "audio"].map((value) => ({ label: t(`config.channelEditor.capabilities.${value}`), value: value as ModelCapability }));

    useEffect(() => {
        setBulkOpen(false);
        setBulkKeys("");
        if (open && channel) setDraft(channel.apiFormat === "agnes" ? { ...channel, baseUrl: AGNES_BASE_URL } : channel);
    }, [open, channel]);

    if (!draft) return null;

    const multipleKeys = draft.apiFormat === "agnes" && (draft.apiKeyMode === "round-robin" || draft.apiKeyMode === "random");
    const existingKeys = new Set((draft.apiKeys || []).map((item) => item.value.trim()));
    const appendedKeys = [...new Set(bulkKeys.split(/\r?\n/).map((value) => value.trim()).filter(Boolean))].filter((value) => !existingKeys.has(value));
    const patch = (value: Partial<ModelChannel>) => setDraft((current) => (current ? { ...current, ...value } : current));
    const setModels = (models: ChannelModel[]) => patch({ models });
    const closeBulk = () => { setBulkOpen(false); setBulkKeys(""); };
    const appendKeys = () => {
        if (!appendedKeys.length) return;
        patch({ apiKeys: [...(draft.apiKeys || []), ...appendedKeys.map((value) => ({ id: nanoid(), value }))] });
        closeBulk();
    };

    const changeApiFormat = (apiFormat: ApiCallFormat) => {
        if (apiFormat === draft.apiFormat) return;
        const baseUrl = apiFormat === "agnes" || !draft.baseUrl.trim() || draft.baseUrl.trim() === defaultBaseUrlForApiFormat(draft.apiFormat) ? defaultBaseUrlForApiFormat(apiFormat) : draft.baseUrl;
        patch({ apiFormat, baseUrl, models: apiFormat === "agnes" && !draft.models.length ? normalizeChannelModels(AGNES_FLASH_MODELS) : draft.models });
    };

    const applySelection = (names: string[]) => {
        const map = new Map(draft.models.map((model) => [model.name, model]));
        setModels(names.map((name) => map.get(name) || { name, capability: guessCapability(name) }));
    };

    const setCapability = (name: string, capability: ModelCapability) => setModels(draft.models.map((model) => (model.name === name ? { ...model, capability } : model)));
    const setScript = (name: string, script: string) => setModels(draft.models.map((model) => (model.name === name ? { ...model, script: script || undefined } : model)));
    const removeModel = (name: string) => setModels(draft.models.filter((model) => model.name !== name));

    const save = () => {
        const apiKeys = normalizeChannelApiKeys(draft.apiKeys || [], channel?.apiKeys || []);
        onSave({ ...draft, apiKeys, apiKey: multipleKeys ? apiKeys[0]?.value || "" : draft.apiKey, name: draft.name.trim() || t("config.channels.unnamed"), models: normalizeChannelModels(draft.models) });
        onClose();
    };

    return (
        <Drawer
            open={open}
            width={640}
            title={t("config.channelEditor.title")}
            onClose={onClose}
            styles={{ body: { paddingTop: 16 } }}
            extra={
                <Space>
                    <Button onClick={onClose}>{t("common.cancel")}</Button>
                    <Button type="primary" onClick={save}>
                        {t("common.save")}
                    </Button>
                </Space>
            }
        >
            <div className="grid gap-4 md:grid-cols-2">
                <label className="block">
                    <span className="mb-1 block text-sm font-medium">{t("config.channelEditor.name")}</span>
                    <Input value={draft.name} onChange={(event) => patch({ name: event.target.value })} />
                </label>
                <label className="block">
                    <span className="mb-1 block text-sm font-medium">{t("config.channelEditor.protocol")}</span>
                    <Select className="w-full" value={draft.apiFormat} options={apiFormatOptions} onChange={changeApiFormat} />
                </label>
                <label className="block md:col-span-2">
                    <span className="mb-1 block text-sm font-medium">{t("config.channelEditor.baseUrl")}</span>
                    <Input value={draft.baseUrl} readOnly={draft.apiFormat === "agnes"} onChange={(event) => patch({ baseUrl: event.target.value })} placeholder="https://api.example.com" />
                </label>
                {draft.apiFormat === "agnes" ? <div className="md:col-span-2">
                    <span className="mb-1 block text-sm font-medium">{t("config.channelEditor.keyMode")}</span>
                    <Segmented block value={draft.apiKeyMode || "single"} options={(["single", "round-robin", "random"] as const).map((value) => ({ value, label: t(`config.channelEditor.keyModes.${value}`) }))} onChange={(value) => patch({ apiKeyMode: value as ApiKeyMode, apiKeys: draft.apiKeys?.length ? draft.apiKeys : [{ id: nanoid(), value: draft.apiKey }] })} />
                </div> : null}
                {multipleKeys ? <div className="space-y-2 md:col-span-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-sm font-medium">API Keys</span>
                        <div className="flex items-center gap-1">
                            <Button type="text" size="small" icon={<Plus className="size-3.5" />} onClick={() => patch({ apiKeys: [...(draft.apiKeys || []), { id: nanoid(), value: "" }] })}>{t("config.channelEditor.addKey")}</Button>
                            <Button type="text" size="small" icon={<ListPlus className="size-3.5" />} onClick={() => setBulkOpen(true)}>{t("config.channelEditor.bulkAddKeys")}</Button>
                        </div>
                    </div>
                    {(draft.apiKeys || []).map((item, index) => <div key={item.id} className="flex items-center gap-2">
                        <Input.Password aria-label={`API Key ${index + 1}`} value={item.value} placeholder={`API Key ${index + 1}`} onChange={(event) => patch({ apiKeys: draft.apiKeys?.map((key) => key.id === item.id ? { ...key, value: event.target.value } : key) })} />
                        <Button type="text" danger aria-label={t("config.channelEditor.removeKey", { index: index + 1 })} icon={<Trash2 className="size-4" />} onClick={() => patch({ apiKeys: draft.apiKeys?.filter((key) => key.id !== item.id) })} />
                    </div>)}
                    <p className="text-xs leading-5 opacity-60">{t("config.channelEditor.multipleKeysHint")}</p>
                </div> : <label className="block md:col-span-2">
                    <span className="mb-1 block text-sm font-medium">API Key</span>
                    <Input.Password value={draft.apiKey} onChange={(event) => patch({ apiKey: event.target.value })} placeholder="sk-..." />
                </label>}
            </div>
            {draft.apiFormat === "agnes" ? (
                <div className="mt-3 space-y-1 text-xs opacity-60">
                    <p>{t("config.channelEditor.agnesHint")}</p>
                    <p>{t("config.channelEditor.agnesLimits")}</p>
                </div>
            ) : null}

            <div className="mt-6 mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                    <div className="text-sm font-semibold">{t("config.channelEditor.models")}</div>
                    <div className="mt-0.5 text-xs text-stone-500">{t("config.channelEditor.modelDescription", { count: draft.models.length })}</div>
                </div>
                <Button type="primary" icon={<ListPlus className="size-4" />} onClick={() => setSelectOpen(true)}>
                    {t("config.channelEditor.selectModels")}
                </Button>
            </div>

            <div className="space-y-2 rounded-lg border border-stone-200 p-2 dark:border-stone-800">
                {draft.models.length ? (
                    draft.models.map((model) => (
                        <div key={model.name} className="flex flex-wrap items-center gap-3 rounded-md px-2 py-1.5 hover:bg-stone-50 dark:hover:bg-stone-900/40">
                            <span className="min-w-0 flex-1 truncate text-sm" title={model.name}>
                                {model.name}
                            </span>
                            <div className="flex shrink-0 items-center gap-2">
                                <Segmented size="small" value={model.capability} options={capabilityOptions} onChange={(value) => setCapability(model.name, value as ModelCapability)} />
                                <Button size="small" type={model.script ? "primary" : "default"} ghost={Boolean(model.script)} onClick={() => setScriptTarget({ name: model.name, capability: model.capability, value: model.script || "" })}>
                                    {t(model.script ? "config.channelEditor.scriptReady" : "config.channelEditor.script")}
                                </Button>
                                <Button size="small" danger type="text" icon={<Trash2 className="size-3.5" />} onClick={() => removeModel(model.name)} />
                            </div>
                        </div>
                    ))
                ) : (
                    <div className="px-2 py-8 text-center text-sm text-stone-500">{t("config.channelEditor.empty")}</div>
                )}
            </div>

            <Modal title={t("config.channelEditor.bulkAddKeys")} open={bulkOpen} onCancel={closeBulk} onOk={appendKeys} okText={t("config.channelEditor.appendKeyCount", { count: appendedKeys.length })} cancelText={t("common.cancel")} okButtonProps={{ disabled: !appendedKeys.length }} destroyOnHidden>
                <Input.TextArea autoFocus rows={6} value={bulkKeys} onChange={(event) => setBulkKeys(event.target.value)} placeholder={t("config.channelEditor.bulkKeysPlaceholder")} aria-label={t("config.channelEditor.bulkAddKeys")} autoComplete="off" spellCheck={false} />
                <p className="mt-2 text-xs leading-5 opacity-60">{t("config.channelEditor.bulkKeysHint")}</p>
            </Modal>

            <ModelSelectModal open={selectOpen} channel={draft} selectedNames={draft.models.map((model) => model.name)} onConfirm={applySelection} onClose={() => setSelectOpen(false)} />

            <ModelScriptEditor
                open={Boolean(scriptTarget)}
                capability={scriptTarget?.capability || "text"}
                modelName={scriptTarget?.name || ""}
                value={scriptTarget?.value || ""}
                onSave={(script) => scriptTarget && setScript(scriptTarget.name, script)}
                onClose={() => setScriptTarget(null)}
            />
        </Drawer>
    );
}
