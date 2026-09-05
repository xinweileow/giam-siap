import { NextResponse } from "next/server";
import { getOwnerSession, setOwnerSession } from "@/lib/ownerSessions";

export const dynamic = "force-dynamic";

/** GET /api/owner-session?telegramUserId=<id> -> {address, createdAt} | 404 (§4.5 step 2). */
export async function GET(request: Request) {
  const telegramUserId = new URL(request.url).searchParams.get("telegramUserId");
  if (!telegramUserId) {
    return NextResponse.json({ error: "telegramUserId query param is required" }, { status: 400 });
  }
  const session = getOwnerSession(telegramUserId);
  if (!session) {
    return NextResponse.json({ error: "no session for this telegramUserId yet" }, { status: 404 });
  }
  return NextResponse.json(session);
}

/** POST /api/owner-session {telegramUserId, address} -> persists the mapping (§4.5 step 2). Called
 * by the /auth page once Enoki resolves a real zkLogin address for a new or returning owner. */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const telegramUserId = body?.telegramUserId;
  const address = body?.address;
  if (typeof telegramUserId !== "string" || typeof address !== "string") {
    return NextResponse.json({ error: "telegramUserId and address (strings) are required" }, { status: 400 });
  }
  const session = setOwnerSession(telegramUserId, address);
  return NextResponse.json(session);
}
