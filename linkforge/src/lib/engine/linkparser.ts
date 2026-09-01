import * as cheerio from "cheerio";
// cheerio v1 no longer re-exports the DOM node types; they come from
// domhandler, which cheerio itself depends on.
import type { Element } from "domhandler";
import { normaliseUrl, registrableDomain } from "./url";

export type LinkPosition = "content" | "nav" | "footer" | "sidebar" | "comment" | "unknown";

export interface ExtractedLink {
  href: string;
  anchorText: string;
  rel: string | null;
  isNofollow: boolean;
  isSponsored: boolean;
  isUgc: boolean;
  position: LinkPosition;
  surroundingText: string;
  isImageLink: boolean;
}

export interface PageInfo {
  title: string | null;
  metaDescription: string | null;
  canonical: string | null;
  language: string | null;
  metaRobots: string | null;
  isIndexable: boolean;
  bodyText: string;
  wordCount: number;
  links: ExtractedLink[];
  internalLinkCount: number;
  externalLinkCount: number;
  /** Distinct external registrable domains linked from this page. */
  externalDomains: string[];
  hasContactPage: boolean;
  emails: string[];
}

const NAV_SELECTORS = "nav, header, [role='navigation'], .nav, .navbar, .menu, #menu";
const FOOTER_SELECTORS = "footer, [role='contentinfo'], .footer, #footer, .site-footer";
const SIDEBAR_SELECTORS = "aside, [role='complementary'], .sidebar, #sidebar, .widget";
const COMMENT_SELECTORS =
  "#comments, .comments, .comment-list, [id^='comment-'], [class*='comment-body'], .disqus";

/**
 * Where a link sits matters more than most people expect. A sitewide footer
 * link carries far less weight than an in-content editorial link, and a
 * footer/sidewide pattern is itself a spam signal.
 */
function classifyPosition($: cheerio.CheerioAPI, el: Element): LinkPosition {
  const node = $(el);
  if (node.closest(COMMENT_SELECTORS).length > 0) return "comment";
  if (node.closest(FOOTER_SELECTORS).length > 0) return "footer";
  if (node.closest(NAV_SELECTORS).length > 0) return "nav";
  if (node.closest(SIDEBAR_SELECTORS).length > 0) return "sidebar";
  if (node.closest("article, main, .post, .entry-content, .content, [role='main']").length > 0) {
    return "content";
  }
  return "unknown";
}

const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,24}\b/g;

// Addresses that exist on every CMS install and belong to nobody useful.
const EMAIL_NOISE = /^(no-?reply|do-?not-?reply|postmaster|abuse|webmaster@example|.*@(example|sentry|wordpress|localhost)\.)/i;

export function parsePage(html: string, pageUrl: string): PageInfo {
  const $ = cheerio.load(html);

  // Strip non-content nodes before measuring text so word counts and
  // surrounding-text snippets are not polluted by scripts and styles.
  $("script, style, noscript, template, svg, iframe").remove();

  const title = $("head > title").first().text().trim() || null;
  const metaDescription =
    $("meta[name='description']").attr("content")?.trim() ||
    $("meta[property='og:description']").attr("content")?.trim() ||
    null;
  const canonicalRaw = $("link[rel='canonical']").attr("href")?.trim();
  const canonical = canonicalRaw ? normaliseUrl(canonicalRaw, pageUrl) : null;

  const language =
    $("html").attr("lang")?.trim().slice(0, 12).toLowerCase() ||
    $("meta[http-equiv='content-language']").attr("content")?.trim().toLowerCase() ||
    null;

  const metaRobots =
    $("meta[name='robots'], meta[name='googlebot']")
      .map((_, el) => $(el).attr("content") ?? "")
      .get()
      .join(",")
      .toLowerCase() || null;

  const isIndexable = !(metaRobots?.includes("noindex") ?? false);

  const bodyText = $("body").text().replace(/\s+/g, " ").trim();
  const wordCount = bodyText ? bodyText.split(/\s+/).length : 0;

  const pageDomain = registrableDomain(pageUrl);
  const links: ExtractedLink[] = [];
  const externalDomains = new Set<string>();
  let internalLinkCount = 0;
  let externalLinkCount = 0;

  $("a[href]").each((_, el) => {
    const node = $(el);
    const rawHref = node.attr("href")?.trim();
    if (!rawHref) return;
    if (/^(mailto:|tel:|javascript:|#|data:)/i.test(rawHref)) return;

    const href = normaliseUrl(rawHref, pageUrl);
    if (!href) return;

    const linkDomain = registrableDomain(href);
    const isInternal = linkDomain !== null && linkDomain === pageDomain;
    if (isInternal) {
      internalLinkCount++;
    } else {
      externalLinkCount++;
      if (linkDomain) externalDomains.add(linkDomain);
    }

    const rel = node.attr("rel")?.trim().toLowerCase() ?? null;
    const relTokens = new Set(rel ? rel.split(/\s+/) : []);

    const anchorText = node.text().replace(/\s+/g, " ").trim();
    const isImageLink = anchorText === "" && node.find("img").length > 0;
    const imgAlt = isImageLink
      ? (node.find("img").first().attr("alt")?.trim() ?? "")
      : "";

    // Grab the sentence the link sits in. Editorial links have real prose
    // around them; link-farm links sit in a bare list of anchors.
    const container = node.parent();
    const contextRaw = container.text().replace(/\s+/g, " ").trim();
    const surroundingText = contextRaw.slice(0, 400);

    links.push({
      href,
      anchorText: anchorText || (imgAlt ? `[img] ${imgAlt}` : ""),
      rel,
      isNofollow: relTokens.has("nofollow"),
      isSponsored: relTokens.has("sponsored"),
      isUgc: relTokens.has("ugc"),
      position: classifyPosition($, el),
      surroundingText,
      isImageLink,
    });
  });

  const hasContactPage = $("a[href]").toArray().some((el) => {
    const href = ($(el).attr("href") ?? "").toLowerCase();
    const text = $(el).text().toLowerCase();
    return /contact|about|write-for-us|submit|editorial|advertise|team|staff/.test(
      `${href} ${text}`,
    );
  });

  const emails = [
    ...new Set(
      (html.match(EMAIL_RE) ?? [])
        .map((e) => e.toLowerCase())
        .filter((e) => !EMAIL_NOISE.test(e))
        .filter((e) => !/\.(png|jpe?g|gif|webp|svg|css|js)$/i.test(e)),
    ),
  ].slice(0, 25);

  return {
    title,
    metaDescription,
    canonical,
    language,
    metaRobots,
    isIndexable,
    bodyText,
    wordCount,
    links,
    internalLinkCount,
    externalLinkCount,
    externalDomains: [...externalDomains],
    hasContactPage,
    emails,
  };
}

/** Links on `html` that point at `targetDomain` (or any of its subdomains). */
export function findLinksTo(
  page: PageInfo,
  targetDomain: string,
): ExtractedLink[] {
  const target = registrableDomain(targetDomain);
  if (!target) return [];
  return page.links.filter((l) => registrableDomain(l.href) === target);
}
