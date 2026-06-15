import { NextResponse } from "next/server";
import { getOrSetCsrfCookie } from "@/lib/csrf";

export async function GET() {
  const token = await getOrSetCsrfCookie();
  return NextResponse.json(
    { token },
    { headers: { "Cache-Control": "no-store" } },
  );
}
