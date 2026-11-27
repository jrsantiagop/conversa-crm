import { NextResponse } from "next/server";
import { isPostgres } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Liveness endpoint. Intentionally dependency-free: it must answer even when
 * no database or channel credentials are configured.
 */
export function GET() {
  let storage: "postgres" | "local" = "local";
  try {
    storage = isPostgres() ? "postgres" : "local";
  } catch {
    // A broken or partial configuration must not turn a health check into a 500.
    storage = "local";
  }

  return NextResponse.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    storage,
    version: "0.1.0",
  });
}
