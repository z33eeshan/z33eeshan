import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isHomepage,
  normaliseUrl,
  pathDepth,
  publicSuffix,
  registrableDomain,
  sameDomain,
  toHostname,
} from "@/lib/engine/url";

test("registrableDomain collapses subdomains", () => {
  assert.equal(registrableDomain("https://news.example.com/a/b"), "example.com");
  assert.equal(registrableDomain("www.example.com"), "example.com");
  assert.equal(registrableDomain("example.com"), "example.com");
});

test("registrableDomain handles multi-part public suffixes", () => {
  assert.equal(registrableDomain("https://www.bbc.co.uk/news"), "bbc.co.uk");
  assert.equal(registrableDomain("sub.site.com.au"), "site.com.au");
});

test("registrableDomain falls back to the host for IPs and unlisted TLDs", () => {
  // psl returns null for these; we keep the host so sources never silently vanish.
  assert.equal(registrableDomain("http://192.168.1.1/page"), "192.168.1.1");
  assert.equal(registrableDomain("http://intranet-box/page"), "intranet-box");
});

test("registrableDomain rejects junk", () => {
  assert.equal(registrableDomain(""), null);
  assert.equal(registrableDomain("not a url at all !!"), null);
});

test("toHostname strips www and trailing dots", () => {
  assert.equal(toHostname("https://www.example.com./x"), "example.com");
});

test("normaliseUrl strips tracking params but keeps real ones", () => {
  assert.equal(
    normaliseUrl("https://x.com/p?utm_source=news&id=7&fbclid=abc"),
    "https://x.com/p?id=7",
  );
});

test("normaliseUrl sorts params so key order does not create duplicates", () => {
  assert.equal(
    normaliseUrl("https://x.com/p?b=2&a=1"),
    normaliseUrl("https://x.com/p?a=1&b=2"),
  );
});

test("normaliseUrl drops fragments, default ports and trailing slashes", () => {
  assert.equal(normaliseUrl("https://x.com:443/a/#section"), "https://x.com/a");
  assert.equal(normaliseUrl("http://x.com:80/a/"), "http://x.com/a");
  // The bare root keeps its slash.
  assert.equal(normaliseUrl("https://x.com"), "https://x.com/");
});

test("normaliseUrl resolves relative hrefs against a base", () => {
  assert.equal(
    normaliseUrl("/about", "https://x.com/blog/post"),
    "https://x.com/about",
  );
  assert.equal(
    normaliseUrl("../up", "https://x.com/a/b/c"),
    "https://x.com/a/up",
  );
});

test("normaliseUrl rejects non-http schemes", () => {
  assert.equal(normaliseUrl("mailto:a@b.com"), null);
  assert.equal(normaliseUrl("javascript:alert(1)"), null);
  assert.equal(normaliseUrl("ftp://x.com/f"), null);
});

test("sameDomain compares registrable domains, not hostnames", () => {
  assert.equal(sameDomain("https://a.example.com", "https://b.example.com"), true);
  assert.equal(sameDomain("https://example.com", "https://example.org"), false);
});

test("publicSuffix returns the suffix", () => {
  assert.equal(publicSuffix("example.co.uk"), "co.uk");
  assert.equal(publicSuffix("spam.xyz"), "xyz");
});

test("pathDepth and isHomepage", () => {
  assert.equal(pathDepth("https://x.com/"), 0);
  assert.equal(pathDepth("https://x.com/a"), 1);
  assert.equal(pathDepth("https://x.com/a/b/c/"), 3);
  assert.equal(isHomepage("https://x.com/"), true);
  assert.equal(isHomepage("https://x.com/a"), false);
});
