import { NextResponse } from "next/server";
import { getSnapshot } from "@/lib/store";

// Always dynamic — this reflects live chain state, never a build-time or ISR-cached response.
export const dynamic = "force-dynamic";

export async function GET() {
  const snapshot = await getSnapshot();
  return NextResponse.json(snapshot);
}
