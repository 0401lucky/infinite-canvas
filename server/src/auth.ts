import { createHash, randomBytes } from "node:crypto";
import argon2 from "argon2";
import cookieParser from "cookie-parser";
import express, { type RequestHandler } from "express";
import { z } from "zod";

import { config } from "./config.js";
import { ApiError, db } from "./storage.js";

const cookieName = "canvas_session";
const cookieOptions = { httpOnly: true, sameSite: "strict" as const, secure: config.secureCookie, path: "/api" };
type Admin = { username: string; password_hash: string };
const admin = () => db.prepare("SELECT username, password_hash FROM admin WHERE id = 1").get() as Admin;
const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
const user = () => ({ id: "1", username: admin().username });

export async function initializeAdmin() {
    const current = admin();
    const password = process.env.ADMIN_PASSWORD;
    const username = process.env.ADMIN_USERNAME?.trim() || current?.username || "admin";
    if (!current && !password) throw new Error("首次启动必须设置 ADMIN_PASSWORD");
    const passwordChanged = Boolean(password && (!current || !await argon2.verify(current.password_hash, password)));
    if (!current || passwordChanged || username !== current.username) {
        const hash = passwordChanged ? await argon2.hash(password!, { type: argon2.argon2id }) : current.password_hash;
        db.transaction(() => {
            db.prepare("INSERT INTO admin VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET username = excluded.username, password_hash = excluded.password_hash").run(username, hash);
            db.prepare("DELETE FROM sessions").run();
        })();
    }
    db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(Date.now());
}

export const cookies = cookieParser();
export function validSession(cookies: Record<string, unknown>) {
    const token = cookies[cookieName];
    return typeof token === "string" && Boolean(db.prepare("SELECT 1 FROM sessions WHERE token_hash = ? AND expires_at > ?").get(tokenHash(token), Date.now()));
}

export const checkOrigin: RequestHandler = (req, _res, next) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && req.get("origin") !== config.origin) return next(new ApiError(403, "INVALID_ORIGIN", "请求来源不允许"));
    next();
};

export const requireSession: RequestHandler = (req, res, next) => {
    if (validSession(req.cookies)) return next();
    res.clearCookie(cookieName, cookieOptions);
    next(new ApiError(401, "UNAUTHORIZED", "请重新登录"));
};

export const authRouter = express.Router();
authRouter.get("/session", (req, res) => {
    const valid = validSession(req.cookies);
    if (!valid) res.clearCookie(cookieName, cookieOptions);
    res.json({ data: { user: valid ? user() : null } });
});
authRouter.post("/login", async (req, res) => {
    const input = z.object({ username: z.string().min(1), password: z.string().min(1) }).parse(req.body);
    const account = admin();
    const correct = await argon2.verify(account.password_hash, input.password);
    if (!correct || input.username !== account.username) throw new ApiError(401, "INVALID_CREDENTIALS", "用户名或密码错误");
    const token = randomBytes(32).toString("base64url");
    const expires = Date.now() + config.sessionMs;
    db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(Date.now());
    db.prepare("INSERT INTO sessions VALUES (?, ?)").run(tokenHash(token), expires);
    res.cookie(cookieName, token, { ...cookieOptions, expires: new Date(expires) });
    res.json({ data: { user: user() } });
});
authRouter.delete("/session", (req, res) => {
    const token = req.cookies[cookieName];
    if (typeof token === "string") db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash(token));
    res.clearCookie(cookieName, cookieOptions);
    res.status(204).end();
});
