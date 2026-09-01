import { z } from "zod";
import { handler, ok, parseBody } from "@/lib/api";
import { contactsFor, discoverContacts } from "@/lib/engine/contacts";
import { registrableDomain } from "@/lib/engine/url";
import { ready } from "@/lib/db";

export const dynamic = "force-dynamic";

export const GET = handler(async (req: Request) => {
  const url = new URL(req.url);
  const domain = url.searchParams.get("domain");
  if (domain) return ok({ contacts: contactsFor(domain) });

  const rows = ready()
    .prepare<[], { id: number; domain: string; email: string; role: string | null; confidence: number }>(
      `SELECT id, domain, email, role, confidence FROM contacts
        ORDER BY confidence DESC LIMIT 500`,
    )
    .all();
  return ok({ contacts: rows });
});

const schema = z.object({
  domain: z.string().min(3),
  /** Extra pages to check, e.g. the exact prospect URL. */
  urls: z.array(z.string().url()).max(10).default([]),
});

/** Synchronous discovery for a single domain — fast enough to await inline. */
export const POST = handler(async (req: Request) => {
  const { domain, urls } = await parseBody(req, schema);
  const normalised = registrableDomain(domain);
  if (!normalised) return ok({ contacts: [], note: "Could not parse that domain." }, 422);
  const contacts = await discoverContacts(normalised, urls);
  return ok({
    contacts,
    note:
      contacts.length === 0
        ? "No published contact addresses found on this site's contact pages."
        : `Found ${contacts.length} published address(es).`,
  });
});
