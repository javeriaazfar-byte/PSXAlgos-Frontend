import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { signBackendJwt } from "@/lib/api/jwt";
import { listNotifications, type ListParams } from "@/lib/api/notifications";

const EMPTY = { items: [], next_cursor: null, unread_count: 0 } as const;

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json(EMPTY);
  }
  const url = new URL(req.url);
  const params: ListParams = {};
  const unreadOnly = url.searchParams.get("unread_only");
  if (unreadOnly !== null) params.unread_only = unreadOnly === "true";
  const limit = url.searchParams.get("limit");
  if (limit !== null) {
    const n = parseInt(limit, 10);
    if (Number.isFinite(n) && n >= 1 && n <= 50) params.limit = n;
  }
  const cursor = url.searchParams.get("cursor");
  if (cursor) params.cursor = cursor;

  const jwt = signBackendJwt({
    sub: session.user.id,
    email: session.user.email,
  });
  try {
    return NextResponse.json(await listNotifications(jwt, params));
  } catch {
    // Non-critical chrome — degrade to an empty list rather than surfacing a
    // backend/auth error to the drawer (and the dev error overlay).
    return NextResponse.json(EMPTY);
  }
}
