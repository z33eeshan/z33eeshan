import { handler, ok } from "@/lib/api";
import { disconnect, isConnected, listSites } from "@/lib/providers/gsc";

export const dynamic = "force-dynamic";

export const GET = handler(async () => {
  if (!isConnected()) {
    return ok({ connected: false, sites: [] });
  }
  const sites = await listSites();
  return ok({ connected: true, sites });
});

export const DELETE = handler(async () => {
  disconnect();
  return ok({ connected: false });
});
