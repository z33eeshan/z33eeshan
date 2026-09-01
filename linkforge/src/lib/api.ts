import { NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";

/** Uniform JSON error shape so the client never has to guess. */
export function fail(message: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status });
}

export function ok<T>(data: T, status = 200) {
  return NextResponse.json({ ok: true, ...data }, { status });
}

/**
 * Wraps a handler so a thrown error becomes a 500 with a readable message
 * instead of an opaque stack trace in the browser console.
 */
export function handler<A extends unknown[]>(
  fn: (...args: A) => Promise<Response>,
): (...args: A) => Promise<Response> {
  return async (...args: A) => {
    try {
      return await fn(...args);
    } catch (err) {
      if (err instanceof ZodError) {
        return fail("Invalid request", 422, { issues: err.issues });
      }
      const message = err instanceof Error ? err.message : String(err);
      return fail(message, 500);
    }
  };
}

export async function parseBody<T>(req: Request, schema: ZodType<T>): Promise<T> {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    json = {};
  }
  return schema.parse(json);
}

export function intParam(
  value: string | null,
  fallback: number,
  { min = 0, max = Number.MAX_SAFE_INTEGER } = {},
): number {
  const n = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}
