import assert from "node:assert/strict";
import { test } from "node:test";
import { agentToken, crawlDelayFor, isAllowed, parseRobots } from "@/lib/engine/robots";

const UA = "LinkForgeBot/0.1 (+https://example.com/bot)";

test("agentToken extracts the product token", () => {
  assert.equal(agentToken(UA), "linkforgebot");
});

test("empty robots.txt allows everything", () => {
  const rules = parseRobots("");
  assert.equal(isAllowed(rules, UA, "https://x.com/anything"), true);
});

test("wildcard disallow blocks matching paths", () => {
  const rules = parseRobots("User-agent: *\nDisallow: /private/");
  assert.equal(isAllowed(rules, UA, "https://x.com/private/page"), false);
  assert.equal(isAllowed(rules, UA, "https://x.com/public/page"), true);
});

test("Disallow with an empty value means allow all", () => {
  const rules = parseRobots("User-agent: *\nDisallow:");
  assert.equal(isAllowed(rules, UA, "https://x.com/anything"), true);
});

test("longest match wins, and Allow beats Disallow at equal length", () => {
  const rules = parseRobots(
    "User-agent: *\nDisallow: /a/\nAllow: /a/public/",
  );
  assert.equal(isAllowed(rules, UA, "https://x.com/a/private"), false);
  assert.equal(isAllowed(rules, UA, "https://x.com/a/public/x"), true);
});

test("a named agent group beats the wildcard group", () => {
  const rules = parseRobots(
    "User-agent: *\nDisallow: /\n\nUser-agent: linkforgebot\nDisallow: /admin/",
  );
  // Our specific group only blocks /admin, so the blanket wildcard does not apply.
  assert.equal(isAllowed(rules, UA, "https://x.com/news"), true);
  assert.equal(isAllowed(rules, UA, "https://x.com/admin/x"), false);
});

test("an unrelated named group does not apply to us", () => {
  const rules = parseRobots(
    "User-agent: badbot\nDisallow: /\n\nUser-agent: *\nAllow: /",
  );
  assert.equal(isAllowed(rules, UA, "https://x.com/x"), true);
});

test("consecutive User-agent lines share one rule group", () => {
  const rules = parseRobots(
    "User-agent: linkforgebot\nUser-agent: otherbot\nDisallow: /shared/",
  );
  assert.equal(isAllowed(rules, UA, "https://x.com/shared/x"), false);
});

test("wildcard patterns inside a path", () => {
  const rules = parseRobots("User-agent: *\nDisallow: /*/private");
  assert.equal(isAllowed(rules, UA, "https://x.com/a/private"), false);
  assert.equal(isAllowed(rules, UA, "https://x.com/a/public"), true);
});

test("$ anchors the pattern to the end of the path", () => {
  const rules = parseRobots("User-agent: *\nDisallow: /*.pdf$");
  assert.equal(isAllowed(rules, UA, "https://x.com/doc.pdf"), false);
  assert.equal(isAllowed(rules, UA, "https://x.com/doc.pdf.html"), true);
});

test("comments and blank lines are ignored", () => {
  const rules = parseRobots("# a comment\n\nUser-agent: *  # inline\nDisallow: /x/");
  assert.equal(isAllowed(rules, UA, "https://x.com/x/y"), false);
});

test("crawl-delay is read from the matching group", () => {
  const rules = parseRobots("User-agent: *\nCrawl-delay: 10\nDisallow: /a/");
  assert.equal(crawlDelayFor(rules, UA), 10);
});

test("sitemaps are collected regardless of group", () => {
  const rules = parseRobots(
    "Sitemap: https://x.com/sitemap.xml\nUser-agent: *\nDisallow: /a/",
  );
  assert.deepEqual(rules.sitemaps, ["https://x.com/sitemap.xml"]);
});
