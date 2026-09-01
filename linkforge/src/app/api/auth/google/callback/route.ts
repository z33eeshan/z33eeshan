import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { handler } from "@/lib/api";
import { exchangeCode } from "@/lib/providers/gsc";

export const dynamic = "force-dynamic";

export const GET = handler(async (req: Request) => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  const jar = await cookies();
  const expected = jar.get("lf_oauth_state")?.value;
  jar.delete("lf_oauth_state");

  const back = (params: Record<string, string>) =>
    NextResponse.redirect(
      new URL(`/settings?${new URLSearchParams(params)}`, url.origin),
    );

  if (oauthError) return back({ gsc: "error", reason: oauthError });
  if (!code) return back({ gsc: "error", reason: "missing_code" });
  // Reject a callback whose state does not match the cookie we set — that is
  // either a stale tab or a forged request.
  if (!state || !expected || state !== expected) {
    return back({ gsc: "error", reason: "state_mismatch" });
  }

  try {
    await exchangeCode(code);
    return back({ gsc: "connected" });
  } catch (err) {
    return back({
      gsc: "error",
      reason: err instanceof Error ? err.message : "token_exchange_failed",
    });
  }
});
