import { NextResponse } from "next/server";
import { connection } from "next/server";

import { ApiError, handleRoute } from "@/lib/api/errors";
import { getSensorHistory } from "@/lib/data/history";

const DEFAULT_MINUTES = 60;
const MAX_MINUTES = 60 * 24;
const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 5_000;

function clampInt(
  raw: string | null,
  fallback: number,
  min: number,
  max: number,
): number {
  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(Math.max(parsed, min), max);
}

/**
 * Nível: `public`.
 *
 * Histórico para gráficos. README.md, primeira entrega: "histórico preparado
 * para gráficos".
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ deviceKey: string }> },
): Promise<NextResponse> {
  return handleRoute(async () => {
    await connection();

    const { deviceKey } = await params;
    const url = new URL(request.url);
    const sensorKey = url.searchParams.get("sensorKey");

    if (!sensorKey) {
      throw new ApiError("INVALID_PAYLOAD", "Missing sensorKey query parameter");
    }

    const history = await getSensorHistory(deviceKey, sensorKey, {
      minutes: clampInt(
        url.searchParams.get("minutes"),
        DEFAULT_MINUTES,
        1,
        MAX_MINUTES,
      ),
      limit: clampInt(url.searchParams.get("limit"), DEFAULT_LIMIT, 1, MAX_LIMIT),
    });

    const response = NextResponse.json(history);
    response.headers.set("Cache-Control", "no-store");

    return response;
  });
}
