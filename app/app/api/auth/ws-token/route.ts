// GET /api/auth/ws-token — mints a short-lived backend JWT for opening a
// browser WebSocket connection to the FastAPI `/ws` endpoint.
//
// The browser cannot read NextAuth's server-side session secret, so we mint
// a 5-minute HS256 token here (server-only) and hand back the token plus a
// ready-to-use ws(s):// URL derived from NEXT_PUBLIC_API_BASE_URL.

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { signBackendJwt } from "@/lib/api/jwt";

const WS_TOKEN_TTL_SEC = 300; // 5 minutes — enough for one backtest run

function deriveWsUrl(): string {
  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!apiBase) {
    throw new Error("NEXT_PUBLIC_API_BASE_URL is not set");
  }
  // Strip /api/v1 (backend WS mounts at the root, not under the API prefix)
  // and convert http(s) -> ws(s). Trim trailing slash.
  const trimmed = apiBase.replace(/\/+$/, "").replace(/\/api\/v1$/, "");
  const wsBase = trimmed.replace(/^http(s?):\/\//, (_m, s) => `ws${s}://`);
  return `${wsBase}/ws`;
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let token: string;
  let wsUrl: string;
  try {
    token = signBackendJwt(
      { sub: session.user.id, email: session.user.email },
      WS_TOKEN_TTL_SEC,
    );
    wsUrl = deriveWsUrl();
  } catch (err) {
    const message = err instanceof Error ? err.message : "server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.json(
    { token, ws_url: wsUrl, expires_in: WS_TOKEN_TTL_SEC },
    { headers: { "Cache-Control": "no-store" } },
  );
}
