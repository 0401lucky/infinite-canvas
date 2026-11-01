import { Alert, Button, Form, Input, Spin, theme } from "antd";
import { ArrowUpRight, Layers3, LockKeyhole, UserRound } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Navigate, useLocation } from "react-router-dom";

import { useUserStore } from "@/stores/use-user-store";

export default function LoginPage() {
    const { t } = useTranslation();
    const { token } = theme.useToken();
    const location = useLocation();
    const status = useUserStore((state) => state.status);
    const loading = useUserStore((state) => state.loading);
    const error = useUserStore((state) => state.error);
    const from = new URL((location.state as { from?: string } | null)?.from || "/", window.location.origin);
    const target = from.origin === window.location.origin && from.pathname !== "/login" ? `${from.pathname}${from.search}${from.hash}` : "/";
    if (status === "authenticated") return <Navigate to={target} replace />;

    return (
        <main className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-background px-6 py-12 text-foreground" style={{ backgroundImage: `radial-gradient(${token.colorTextQuaternary} 0.7px, transparent 0.7px)`, backgroundSize: "24px 24px" }}>
            <div className="relative grid w-full max-w-4xl gap-14 md:grid-cols-[1.1fr_1fr] md:items-center">
                <section>
                    <div className="mb-12 flex items-center gap-3 text-sm tracking-[0.14em]"><Layers3 className="size-6" />INFINITE CANVAS</div>
                    <div className="text-xs tracking-[0.2em]" style={{ color: token.colorTextSecondary }}>{t("server.privateWorkspace")}</div>
                    <h1 className="mt-5 text-4xl font-medium leading-tight tracking-tight sm:text-5xl">{t("server.loginTitle")}</h1>
                    <p className="mt-5 max-w-sm text-sm leading-7" style={{ color: token.colorTextSecondary }}>{t("server.loginDescription")}</p>
                </section>
                <section className="rounded-2xl p-7 sm:p-9" style={{ background: token.colorBgContainer, border: `1px solid ${token.colorBorderSecondary}` }}>
                    <div className="mb-7 flex items-center justify-between"><h2 className="text-lg font-semibold">{t("server.adminLogin")}</h2><LockKeyhole className="size-5" style={{ color: token.colorTextTertiary }} /></div>
                    {error ? <Alert className="mb-5" showIcon type="error" title={error} /> : null}
                    {status === "checking" ? <div className="flex h-48 items-center justify-center"><Spin /></div> : (
                        <Form layout="vertical" requiredMark={false} initialValues={{ username: "admin" }} onFinish={(values: { username: string; password: string }) => useUserStore.getState().login(values.username, values.password).catch(() => undefined)}>
                            <Form.Item name="username" label={t("server.username")} rules={[{ required: true, message: t("server.usernameRequired") }]}><Input prefix={<UserRound className="size-4" />} autoComplete="username" size="large" disabled={loading} /></Form.Item>
                            <Form.Item name="password" label={t("server.password")} rules={[{ required: true, message: t("server.passwordRequired") }]}><Input.Password autoComplete="current-password" size="large" disabled={loading} /></Form.Item>
                            <Button type="primary" htmlType="submit" size="large" block loading={loading} icon={<ArrowUpRight className="size-4" />}>{t("server.login")}</Button>
                        </Form>
                    )}
                    <p className="mt-5 text-xs leading-6" style={{ color: token.colorTextTertiary }}>{t("server.loginHint")}</p>
                </section>
            </div>
        </main>
    );
}
