import { getFnosGatewayIdentity, getLinkedFnosUid } from "./fnos-identity";
import type { Context } from "hono";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { JWT_SECRET, verifyLoginToken, type LoginTokenPayload } from "./auth-security";
import { getDb } from "../db/schema";
import { userSessionsRepository } from "../repositories";

export type PrivateMediaKind = "task" | "diary";
const SECRET = crypto.createHmac("sha256", JWT_SECRET).update("private-media-access-v1").digest("hex");
const TTL_SECONDS = 10 * 60;

/** A media capability is bound to one file and the issuing login session, never a login token. */
export function resolvePrivateMediaIdentity(c: Context, kind: PrivateMediaKind, id: string): LoginTokenPayload | null {
  const bearer = c.req.header("Authorization") || "";
  let payload: LoginTokenPayload | null = null;
  if (bearer.startsWith("Bearer ")) payload = verifyLoginToken(bearer.slice(7));
  if (!payload && c.req.query("access") !== "1") {
    try {
      const signed = jwt.verify(c.req.query("mediaAccess") || "", SECRET, { algorithms: ["HS256"] }) as
        Omit<LoginTokenPayload, "typ"> & { kind: PrivateMediaKind; mediaId: string; typ: string };
      if (signed.typ === "private-media" && signed.kind === kind && signed.mediaId === id) payload = { ...signed, typ: "login" };
    } catch { /* Missing, expired or invalid capabilities fail closed. */ }
  }
  if (!payload?.userId || !payload.jti) return null;
  const nas = getFnosGatewayIdentity(c);
  const linkedUid = nas ? getLinkedFnosUid(payload.userId) : null;
  if (linkedUid !== null && linkedUid !== nas?.uid) return null;
  const user = getDb().prepare("SELECT tokenVersion, isDisabled FROM users WHERE id = ?").get(payload.userId) as
    { tokenVersion: number; isDisabled: number } | undefined;
  if (!user || user.isDisabled || (payload.tver ?? 0) !== user.tokenVersion) return null;
  const session = userSessionsRepository.getByIdAndUser(payload.jti, payload.userId);
  if (!session || session.revokedAt || (session.expiresAt && Date.parse(session.expiresAt) <= Date.now())) return null;
  return payload;
}

/** Call only after the resource's current ACL has passed. */
export function privateMediaAccessResponse(c: Context, kind: PrivateMediaKind, id: string, identity: LoginTokenPayload): Response {
  const token = jwt.sign({
    typ: "private-media", kind, mediaId: id, userId: identity.userId,
    tver: identity.tver ?? 0, jti: identity.jti,
  }, SECRET, { algorithm: "HS256", expiresIn: TTL_SECONDS });
  const prefix = kind === "task" ? "/api/task-attachments/" : "/api/diary/attachments/";
  c.header("Cache-Control", "private, no-store");
  c.header("Referrer-Policy", "no-referrer");
  return c.json({ url: `${prefix}${encodeURIComponent(id)}?mediaAccess=${encodeURIComponent(token)}`, expiresAt: Date.now() + TTL_SECONDS * 1000 });
}
