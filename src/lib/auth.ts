import crypto from "node:crypto";
import { cookies } from "next/headers";

/**
 * Minimal single-password admin auth. The session cookie is a stateless
 * signed token, `expiryMs.nonce.hmac`, so every login mints a fresh value
 * and the cookie itself expires server-side. The signing key is
 * SESSION_SECRET when set (recommended: a leaked cookie then says nothing
 * about the password), falling back to ADMIN_PASSWORD so a bare setup still
 * works. Rotating whichever secret signs invalidates all sessions.
 */

export const ADMIN_COOKIE = "oa_admin";
export const SESSION_DAYS = 30;

function signingKey(): string | null {
  return process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD || null;
}

function sign(payload: string, key: string): string {
  return crypto.createHmac("sha256", key).update(payload).digest("hex");
}

export function checkPassword(password: string): boolean {
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw) return false;
  const a = Buffer.from(password);
  const b = Buffer.from(pw);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** A fresh session token; call only after the password has been checked. */
export function cookieValue(): string {
  const key = signingKey();
  if (!key || !process.env.ADMIN_PASSWORD) throw new Error("ADMIN_PASSWORD is not set");
  const payload = `${Date.now() + SESSION_DAYS * 24 * 60 * 60000}.${crypto.randomBytes(16).toString("hex")}`;
  return `${payload}.${sign(payload, key)}`;
}

export async function isAdmin(): Promise<boolean> {
  const key = signingKey();
  if (!key) return false;
  const raw = (await cookies()).get(ADMIN_COOKIE)?.value ?? "";
  const i = raw.lastIndexOf(".");
  if (i < 0) return false;
  const payload = raw.slice(0, i);
  const mac = Buffer.from(raw.slice(i + 1));
  const expected = Buffer.from(sign(payload, key));
  if (mac.length !== expected.length || !crypto.timingSafeEqual(mac, expected)) return false;
  const expiry = Number(payload.split(".")[0]);
  return Number.isFinite(expiry) && Date.now() < expiry;
}

export const LAYOUT_PREVIEW_COOKIE = "oa_layout_preview";

/**
 * Admin-only layout override: forces the weekday or weekend front page in
 * THIS browser only, so the other mode can be inspected and tweaked on any
 * day without touching what visitors see. Ignored for everyone else.
 */
export async function adminLayoutPreview(): Promise<"weekday" | "weekend" | null> {
  if (!(await isAdmin())) return null;
  const v = (await cookies()).get(LAYOUT_PREVIEW_COOKIE)?.value;
  return v === "weekday" || v === "weekend" ? v : null;
}
