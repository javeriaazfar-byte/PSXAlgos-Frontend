import { createHmac } from "node:crypto"

// Mints HS256-signed JWTs the FastAPI backend can verify with PyJWT's
// `audience="authenticated"` + `algorithms=["HS256"]` check
// (psxDataPortal/backend/app/core/auth.py).
//
// Why hand-rolled instead of `jose`? psx-ui's package.json is intentionally
// thin — auth infra exception was spent on `next-auth`. HS256 is 30 lines of
// HMAC-SHA256, no edge cases. `node:crypto` is stdlib, server-only, and this
// file is imported only from server components / route handlers, never edge.

const SERVER_ONLY_GUARD = "use server-only"
if (typeof window !== "undefined") {
  throw new Error(`${SERVER_ONLY_GUARD}: lib/api/jwt.ts loaded in the browser`)
}

function base64url(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input) : input
  return buf
    .toString("base64")
    .replace(/=+$/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
}

export interface BackendJwtPayload {
  sub: string
  email?: string | null
  role?: string
}

export function signBackendJwt(
  payload: BackendJwtPayload,
  expiresInSec = 3600,
): string {
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET
  if (!secret) {
    throw new Error("AUTH_SECRET is not set — cannot mint backend JWT")
  }
  const header = { alg: "HS256", typ: "JWT" }
  const now = Math.floor(Date.now() / 1000)
  const claims = {
    sub: payload.sub,
    email: payload.email ?? undefined,
    role: payload.role ?? "authenticated",
    aud: "authenticated",
    iat: now,
    exp: now + expiresInSec,
  }
  const headerB64 = base64url(JSON.stringify(header))
  const payloadB64 = base64url(JSON.stringify(claims))
  const data = `${headerB64}.${payloadB64}`
  const signature = base64url(
    createHmac("sha256", secret).update(data).digest(),
  )
  return `${data}.${signature}`
}
