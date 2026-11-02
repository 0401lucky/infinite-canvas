import { Alert, App, Button, Empty, Form, Input, Modal, Spin, Switch, theme } from "antd";
import { KeyRound, Plus, RefreshCw, UsersRound } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { createMemberAccount, readMemberAccounts, serverSessionSignal, updateMemberAccount, type MemberAccount } from "@/services/api/server";

export function ConfigAccounts({ active }: { active: boolean }) {
    const { t } = useTranslation();
    const { token } = theme.useToken();
    const { message } = App.useApp();
    const [form] = Form.useForm<{ username: string; password: string }>();
    const [accounts, setAccounts] = useState<MemberAccount[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [open, setOpen] = useState(false);
    const [editing, setEditing] = useState<MemberAccount | null>(null);
    const [saving, setSaving] = useState(false);
    const [updatingId, setUpdatingId] = useState("");

    const refresh = useCallback(async () => {
        const signal = serverSessionSignal();
        setLoading(true);
        setError("");
        try { setAccounts(await readMemberAccounts()); }
        catch (reason) { if (!signal.aborted) setError(reason instanceof Error ? reason.message : t("server.unavailable")); }
        finally { if (!signal.aborted) setLoading(false); }
    }, [t]);
    useEffect(() => { if (active) void refresh(); }, [active, refresh]);

    const save = async (values: { username: string; password: string }) => {
        const signal = serverSessionSignal();
        setSaving(true);
        try {
            const account = editing ? await updateMemberAccount(editing.id, { password: values.password }) : await createMemberAccount(values.username, values.password);
            signal.throwIfAborted();
            setAccounts((current) => editing ? current.map((item) => item.id === account.id ? account : item) : [...current, account]);
            form.resetFields();
            setOpen(false);
            message.success(t(editing ? "config.accounts.passwordReset" : "config.accounts.created"));
        } catch (reason) { if (!signal.aborted) message.error(reason instanceof Error ? reason.message : t("server.unavailable")); }
        finally { if (!signal.aborted) setSaving(false); }
    };

    const setEnabled = async (account: MemberAccount, enabled: boolean) => {
        const signal = serverSessionSignal();
        setUpdatingId(account.id);
        try {
            const updated = await updateMemberAccount(account.id, { disabled: !enabled });
            signal.throwIfAborted();
            setAccounts((current) => current.map((item) => item.id === updated.id ? updated : item));
            message.success(t(enabled ? "config.accounts.enabled" : "config.accounts.disabled"));
        } catch (reason) { if (!signal.aborted) message.error(reason instanceof Error ? reason.message : t("server.unavailable")); }
        finally { if (!signal.aborted) setUpdatingId(""); }
    };

    return (
        <section className="space-y-5 p-1">
            <header className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h3 className="flex items-center gap-2 text-sm font-semibold"><UsersRound className="size-4" />{t("config.accounts.title")}</h3>
                    <p className="mt-2 text-xs leading-6" style={{ color: token.colorTextSecondary }}>{t("config.accounts.description")}</p>
                </div>
                <div className="flex gap-2">
                    <Button type="text" icon={<RefreshCw className="size-4" />} loading={loading} disabled={saving || Boolean(updatingId)} onClick={() => void refresh()}>{t("config.accounts.refresh")}</Button>
                    <Button type="primary" icon={<Plus className="size-4" />} disabled={loading} onClick={() => { setEditing(null); setOpen(true); }}>{t("config.accounts.add")}</Button>
                </div>
            </header>
            <p className="text-xs leading-6" style={{ color: token.colorTextSecondary }}>{t("config.accounts.apiAccess")}</p>
            {error ? <Alert showIcon type="error" title={error} /> : null}
            {loading ? <div className="flex min-h-32 items-center justify-center"><Spin /></div> : !accounts.length && !error ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("config.accounts.empty")} /> : (
                <div className="divide-y" style={{ borderColor: token.colorBorderSecondary }}>
                    {accounts.map((account) => (
                        <div key={account.id} className="flex flex-wrap items-center justify-between gap-3 py-3" style={{ borderColor: token.colorBorderSecondary }}>
                            <div className="min-w-0"><div className="truncate text-sm font-medium">{account.username}</div><div className="mt-1 text-xs" style={{ color: token.colorTextSecondary }}>{t(account.disabled ? "config.accounts.disabledStatus" : "config.accounts.enabledStatus")}</div></div>
                            <div className="flex items-center gap-3">
                                <Button type="text" size="small" icon={<KeyRound className="size-3.5" />} disabled={Boolean(updatingId)} onClick={() => { setEditing(account); setOpen(true); }}>{t("config.accounts.resetPassword")}</Button>
                                <Switch checked={!account.disabled} loading={updatingId === account.id} disabled={Boolean(updatingId)} aria-label={t("config.accounts.enableAccount", { username: account.username })} onChange={(enabled) => void setEnabled(account, enabled)} />
                            </div>
                        </div>
                    ))}
                </div>
            )}
            <Modal title={t(editing ? "config.accounts.resetPassword" : "config.accounts.add")} open={open} destroyOnHidden confirmLoading={saving} closable={!saving} maskClosable={!saving} cancelButtonProps={{ disabled: saving }} okText={t("common.save")} cancelText={t("common.cancel")} onOk={() => form.submit()} onCancel={() => setOpen(false)}>
                <Form form={form} layout="vertical" requiredMark={false} clearOnDestroy initialValues={{ username: editing?.username || "", password: "" }} onFinish={save}>
                    <Form.Item name="username" label={t("server.username")} rules={[{ required: true, whitespace: true, message: t("server.usernameRequired") }]}><Input autoComplete="off" disabled={Boolean(editing) || saving} /></Form.Item>
                    <Form.Item name="password" label={t(editing ? "config.accounts.newPassword" : "server.password")} rules={[{ required: true, message: t("server.passwordRequired") }]}><Input.Password autoComplete="new-password" disabled={saving} /></Form.Item>
                    <p className="text-xs leading-6" style={{ color: token.colorTextSecondary }}>{t(editing ? "config.accounts.resetHint" : "config.accounts.createHint")}</p>
                </Form>
            </Modal>
        </section>
    );
}
