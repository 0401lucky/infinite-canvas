import { createHash, randomBytes, randomUUID } from "node:crypto";
import argon2 from "argon2";
import cookieParser from "cookie-parser";
import express, { type RequestHandler } from "express";
import { z } from "zod";

import { config } from "./config.js";
import { ApiError, db, storageForUser, type UserStorage } from "./storage.js";

const cookieName = "canvas_session";
const cookieOptions = { httpOnly: true, sameSite: "strict" as const, secure: config.secureCookie, path: "/api" };
type Admin = { username: string; password_hash: string };
type Member = Admin & { id: string; disabled: number };
export type User = { id: string; username: string; role: "admin" | "member" };
declare global {
    namespace Express {
        interface Locals { user: User; storage: UserStorage }
    }
}
const admin = () => db.prepare("SELECT username, password_hash FROM admin WHERE id = 1").get() as Admin;
const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
const member = (id: string) => db.prepare("SELECT * FROM members WHERE id = ?").get(id) as Member | undefined;
const memberInfo = (account: Member) => ({ id: account.id, username: account.username, disabled: Boolean(account.disabled) });
const credentials = z.object({ username: z.string().trim().min(1), password: z.string().min(1) });

function requireAvailableUsername(username: string) {
    if (username === admin()?.username || db.prepare("SELECT 1 FROM members WHERE username = ?").get(username)) throw new ApiError(409, "USERNAME_TAKEN", "用户名已存在");
}

export async function initializeAdmin() {
    const current = admin();
    const password = process.env.ADMIN_PASSWORD;
    const username = process.env.ADMIN_USERNAME?.trim() || current?.username || "admin";
    if (!current && !password) throw new Error("首次启动必须设置 ADMIN_PASSWORD");
    if (db.prepare("SELECT 1 FROM members WHERE username = ?").get(username)) throw new Error("ADMIN_USERNAME 与成员账号重名");
    const passwordChanged = Boolean(password && (!current || !await argon2.verify(current.password_hash, password)));
    if (!current || passwordChanged || username !== current.username) {
        const hash = passwordChanged ? await argon2.hash(password!, { type: argon2.argon2id }) : current.password_hash;
        db.transaction(() => {
            db.prepare("INSERT INTO admin VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET username = excluded.username, password_hash = excluded.password_hash").run(username, hash);
            db.prepare("DELETE FROM sessions").run();
        })();
    }
    db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(Date.now());
    db.prepare("DELETE FROM member_sessions WHERE expires_at <= ?").run(Date.now());
}

export const cookies = cookieParser();
export function sessionUser(cookies: Record<string, unknown>): User | undefined {
    const token = cookies[cookieName];
    if (typeof token !== "string") return;
    const hash = tokenHash(token);
    const now = Date.now();
    return db.prepare(`
        SELECT '1' AS id, admin.username, 'admin' AS role FROM sessions JOIN admin ON admin.id = 1
        WHERE token_hash = ? AND expires_at > ?
        UNION ALL
        SELECT members.id, members.username, 'member' AS role FROM member_sessions JOIN members ON members.id = member_sessions.member_id
        WHERE token_hash = ? AND expires_at > ? AND members.disabled = 0
    `).get(hash, now, hash, now) as User | undefined;
}

export const checkOrigin: RequestHandler = (req, _res, next) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && req.get("origin") !== config.origin) return next(new ApiError(403, "INVALID_ORIGIN", "请求来源不允许"));
    next();
};

export const requireSession: RequestHandler = (req, res, next) => {
    const user = sessionUser(req.cookies);
    if (user) {
        const boundUser = req.get("x-canvas-user");
        if (boundUser !== user.id && (boundUser !== undefined || !["GET", "HEAD", "OPTIONS"].includes(req.method))) return next(new ApiError(401, "SESSION_CHANGED", "账号已在其他页面切换，请刷新页面后重新登录"));
        res.locals.user = user;
        res.locals.storage = storageForUser(user.id);
        return next();
    }
    res.clearCookie(cookieName, cookieOptions);
    next(new ApiError(401, "UNAUTHORIZED", "请重新登录"));
};

export const requireAdmin: RequestHandler = (_req, res, next) => {
    if (res.locals.user.role !== "admin") return next(new ApiError(403, "ADMIN_REQUIRED", "仅管理员可以管理账号"));
    next();
};

export const authRouter = express.Router();
authRouter.get("/session", (req, res) => {
    const user = sessionUser(req.cookies);
    if (!user) res.clearCookie(cookieName, cookieOptions);
    res.json({ data: { user: user || null } });
});
authRouter.post("/login", async (req, res) => {
    const input = credentials.parse(req.body);
    const administrator = admin();
    const isAdmin = input.username === administrator.username;
    const account = isAdmin ? { ...administrator, id: "1", disabled: 0 } : db.prepare("SELECT * FROM members WHERE username = ?").get(input.username) as Member | undefined;
    const correct = await argon2.verify(account?.password_hash || administrator.password_hash, input.password);
    const current = isAdmin ? { ...admin(), disabled: 0 } : account && member(account.id);
    if (!correct || !account || !current || current.disabled || current.password_hash !== account.password_hash || current.username !== input.username) throw new ApiError(401, "INVALID_CREDENTIALS", "用户名或密码错误");
    const token = randomBytes(32).toString("base64url");
    const expires = Date.now() + config.sessionMs;
    db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(Date.now());
    db.prepare("DELETE FROM member_sessions WHERE expires_at <= ?").run(Date.now());
    if (isAdmin) db.prepare("INSERT INTO sessions VALUES (?, ?)").run(tokenHash(token), expires);
    else db.prepare("INSERT INTO member_sessions VALUES (?, ?, ?)").run(tokenHash(token), account.id, expires);
    res.cookie(cookieName, token, { ...cookieOptions, expires: new Date(expires) });
    res.json({ data: { user: { id: account.id, username: account.username, role: isAdmin ? "admin" : "member" } } });
});
authRouter.delete("/session", (req, res) => {
    const user = sessionUser(req.cookies);
    if (user && req.get("x-canvas-user") !== user.id) throw new ApiError(401, "SESSION_CHANGED", "账号已在其他页面切换，请刷新页面后重新登录");
    const token = req.cookies[cookieName];
    if (typeof token === "string") {
        db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash(token));
        db.prepare("DELETE FROM member_sessions WHERE token_hash = ?").run(tokenHash(token));
    }
    res.clearCookie(cookieName, cookieOptions);
    res.status(204).end();
});

export const accountsRouter = express.Router();
accountsRouter.use(requireAdmin);
accountsRouter.get("/", (_req, res) => res.json({ data: (db.prepare("SELECT * FROM members ORDER BY username").all() as Member[]).map(memberInfo) }));
accountsRouter.post("/", async (req, res) => {
    const input = credentials.parse(req.body);
    requireAvailableUsername(input.username);
    const hash = await argon2.hash(input.password, { type: argon2.argon2id });
    if (sessionUser(req.cookies)?.role !== "admin") throw new ApiError(401, "UNAUTHORIZED", "请重新登录");
    const id = randomUUID();
    db.transaction(() => {
        requireAvailableUsername(input.username);
        db.prepare("INSERT INTO members (id, username, password_hash) VALUES (?, ?, ?)").run(id, input.username, hash);
    })();
    res.status(201).json({ data: memberInfo(member(id)!) });
});
accountsRouter.put("/:id", async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    const input = z.object({ password: z.string().min(1).optional(), disabled: z.boolean().optional() }).refine((value) => value.password !== undefined || value.disabled !== undefined).parse(req.body);
    if (!member(id)) throw new ApiError(404, "ACCOUNT_NOT_FOUND", "账号不存在");
    const hash = input.password === undefined ? undefined : await argon2.hash(input.password, { type: argon2.argon2id });
    if (sessionUser(req.cookies)?.role !== "admin") throw new ApiError(401, "UNAUTHORIZED", "请重新登录");
    db.transaction(() => {
        const current = member(id)!;
        db.prepare("UPDATE members SET password_hash = ?, disabled = ? WHERE id = ?").run(hash ?? current.password_hash, input.disabled === undefined ? current.disabled : Number(input.disabled), id);
        if (hash || input.disabled) db.prepare("DELETE FROM member_sessions WHERE member_id = ?").run(id);
    })();
    res.json({ data: memberInfo(member(id)!) });
});
