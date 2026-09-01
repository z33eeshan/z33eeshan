import { ready } from "@/lib/db";
import { fetchPage } from "./fetcher";
import { parsePage } from "./linkparser";
import { normaliseUrl, registrableDomain } from "./url";

/**
 * Contact discovery for outreach.
 *
 * Deliberately narrow in scope: this reads publicly published contact details
 * from a site's own contact/about/editorial pages — the addresses those sites
 * put up precisely so people can reach them. It does not attempt email
 * permutation guessing, breach-database lookups, or scraping personal profiles,
 * all of which produce bad data and cause real deliverability and privacy
 * problems.
 *
 * A generic editorial address that reaches a real inbox beats a guessed
 * personal address that bounces and burns your sending domain.
 */

const CONTACT_PATHS = [
  "/contact",
  "/contact-us",
  "/about",
  "/about-us",
  "/editorial-team",
  "/team",
  "/staff",
  "/write-for-us",
  "/contribute",
  "/advertise",
  "/impressum",
];

/** Role weighting: an editor's address is worth far more than a generic one. */
const ROLE_PATTERNS: { re: RegExp; role: string; confidence: number }[] = [
  { re: /^(editor|editors|editorial|news|newsdesk|tips|newsroom)@/i, role: "editorial", confidence: 0.9 },
  { re: /^(press|pr|media|comms)@/i, role: "press", confidence: 0.8 },
  { re: /^(contribute|submissions?|write|guest)@/i, role: "contributions", confidence: 0.85 },
  { re: /^(contact|hello|hi|team|enquiries|inquiries|info)@/i, role: "general", confidence: 0.55 },
  { re: /^(admin|webmaster|support|help)@/i, role: "admin", confidence: 0.4 },
  { re: /^(sales|advertising|ads|partnerships?|sponsor)@/i, role: "commercial", confidence: 0.3 },
];

export interface FoundContact {
  domain: string;
  email: string;
  name: string | null;
  role: string;
  sourceUrl: string;
  confidence: number;
}

function classifyEmail(email: string, domain: string): { role: string; confidence: number } {
  for (const { re, role, confidence } of ROLE_PATTERNS) {
    if (re.test(email)) {
      // An address on the site's own domain is much more likely to be real
      // than a gmail address that happened to appear in the page source.
      const onDomain = email.endsWith(`@${domain}`) || email.includes(`.${domain}`);
      return { role, confidence: onDomain ? confidence : confidence * 0.5 };
    }
  }
  const onDomain = email.endsWith(`@${domain}`);
  // A personal-looking address on the site's own domain, e.g. j.smith@site.com.
  return { role: onDomain ? "named" : "offsite", confidence: onDomain ? 0.6 : 0.2 };
}

/**
 * Crawls a domain's likely contact pages and extracts published addresses.
 * Stops as soon as it finds a high-confidence editorial contact — no reason to
 * hit five more pages on someone's server once we have what we need.
 */
export async function discoverContacts(
  domainInput: string,
  extraUrls: string[] = [],
): Promise<FoundContact[]> {
  const domain = registrableDomain(domainInput);
  if (!domain) return [];

  const candidates: string[] = [];
  for (const u of extraUrls) {
    const n = normaliseUrl(u);
    if (n) candidates.push(n);
  }
  candidates.push(`https://${domain}/`);
  for (const p of CONTACT_PATHS) candidates.push(`https://${domain}${p}`);

  const found = new Map<string, FoundContact>();
  const linkedContactPages = new Set<string>();

  for (const url of candidates.slice(0, 8)) {
    const res = await fetchPage(url, { retries: 2 });
    if (!res.ok || !res.html) continue;

    const page = parsePage(res.html, res.finalUrl);

    for (const email of page.emails) {
      if (found.has(email)) continue;
      const { role, confidence } = classifyEmail(email, domain);
      if (confidence < 0.25) continue;
      found.set(email, {
        domain,
        email,
        name: null,
        role,
        sourceUrl: res.finalUrl,
        confidence,
      });
    }

    // Follow contact-ish links found on the homepage, since many sites use
    // paths we would not have guessed (/kontakt, /reach-us, /connect).
    if (linkedContactPages.size < 4) {
      for (const link of page.links) {
        const linkDomain = registrableDomain(link.href);
        if (linkDomain !== domain) continue;
        if (!/contact|about|editorial|team|write-for-us|contribute|impressum|kontakt/i.test(link.href)) {
          continue;
        }
        if (!candidates.includes(link.href)) linkedContactPages.add(link.href);
      }
    }

    const best = [...found.values()].sort((a, b) => b.confidence - a.confidence)[0];
    if (best && best.confidence >= 0.85) break;
  }

  for (const url of [...linkedContactPages].slice(0, 3)) {
    const res = await fetchPage(url, { retries: 1 });
    if (!res.ok || !res.html) continue;
    const page = parsePage(res.html, res.finalUrl);
    for (const email of page.emails) {
      if (found.has(email)) continue;
      const { role, confidence } = classifyEmail(email, domain);
      if (confidence < 0.25) continue;
      found.set(email, { domain, email, name: null, role, sourceUrl: res.finalUrl, confidence });
    }
  }

  const contacts = [...found.values()].sort((a, b) => b.confidence - a.confidence);
  persistContacts(contacts);
  return contacts;
}

export function persistContacts(contacts: FoundContact[]): void {
  if (contacts.length === 0) return;
  const conn = ready();
  const stmt = conn.prepare(
    `INSERT INTO contacts (domain, email, name, role, source_url, confidence)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (domain, email) DO UPDATE SET
       role = excluded.role,
       source_url = excluded.source_url,
       confidence = MAX(contacts.confidence, excluded.confidence)`,
  );
  conn.transaction(() => {
    for (const c of contacts) {
      stmt.run(c.domain, c.email, c.name, c.role, c.sourceUrl, c.confidence);
    }
  })();
}

export function contactsFor(domain: string): FoundContact[] {
  const d = registrableDomain(domain) ?? domain;
  return ready()
    .prepare<
      [string],
      {
        domain: string;
        email: string;
        name: string | null;
        role: string | null;
        source_url: string | null;
        confidence: number;
      }
    >(
      `SELECT domain, email, name, role, source_url, confidence
         FROM contacts WHERE domain = ? ORDER BY confidence DESC`,
    )
    .all(d)
    .map((r) => ({
      domain: r.domain,
      email: r.email,
      name: r.name,
      role: r.role ?? "unknown",
      sourceUrl: r.source_url ?? "",
      confidence: r.confidence,
    }));
}
