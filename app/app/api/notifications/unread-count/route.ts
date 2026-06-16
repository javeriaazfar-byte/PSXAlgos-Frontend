import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { signBackendJwt } from "@/lib/api/jwt";
import { getUnreadCount } from "@/lib/api/notifications";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    // No session — report zero rather than erroring. The bell polls this on a
    // timer; a hard 401 here just trips the dev error overlay for a piece of
    // non-critical chrome.
    return NextResponse.json({ count: 0 });
  }
  const jwt = signBackendJwt({
    sub: session.user.id,
    email: session.user.email,
  });
  try {
    return NextResponse.json(await getUnreadCount(jwt));
  } catch {
    // The unread badge is non-essential. If the backend is unreachable or the
    // token is rejected, degrade to zero unread instead of surfacing an error
    // response — the next poll recovers once auth/connectivity is restored.
    return NextResponse.json({ count: 0 });
  }
}
