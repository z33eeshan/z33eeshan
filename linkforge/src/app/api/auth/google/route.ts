import crypto from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { fail, handler } from "@/lib/api";
import { authUrl } from "@/lib/providers/gsc";

export const dynamic = "force-dynamic";

/** Starts the Search Console OAuth flow. */
export const GET = handler(async () => {
  if (!config.google.configured) {
    return fail(
      "Google OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env.local.",
      503,
    );
  }

  // CSRF state, stored in an httpOnly cookie and verified on callback.
  const state = crypto.randomBytes(24).toString("hex");
  const jar = await cookies();
  jar.set("lf_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600,
  });

  return NextResponse.redirect(authUrl(state));
});
