import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyAnchor } from "@/lib/engine/anchors";
import {
  estimateDifficulty,
  prospectPriority,
  scoreRelevance,
  vocabularyFromText,
  type Vocabulary,
} from "@/lib/engine/relevance";
import { normaliseRankPosition } from "@/lib/providers/authority";
import { detectDelimiter, parseCsv, parseCsvObjects, toCsv } from "@/lib/engine/csv";
import { buildDisavow } from "@/lib/engine/disavow";
import { classifyUrlOpportunity } from "@/lib/providers/commoncrawl";
import { unreverseHost } from "../scripts/import-domain-ranks";

const BRANDS = ["Live News Of", "livenewsof"];
const MONEY = ["breaking news pakistan", "sports news"];

test("classifyAnchor identifies brand anchors including the bare domain label", () => {
  assert.equal(classifyAnchor("Live News Of", "livenewsof.com", BRANDS, MONEY), "brand");
  assert.equal(classifyAnchor("livenewsof", "livenewsof.com", [], MONEY), "brand");
});

test("classifyAnchor identifies naked URLs", () => {
  assert.equal(
    classifyAnchor("https://livenewsof.com/x", "livenewsof.com", BRANDS, MONEY),
    "naked_url",
  );
  assert.equal(
    classifyAnchor("www.livenewsof.com", "livenewsof.com", BRANDS, MONEY),
    "naked_url",
  );
});

test("classifyAnchor separates exact from partial keyword matches", () => {
  assert.equal(
    classifyAnchor("breaking news pakistan", "livenewsof.com", BRANDS, MONEY),
    "exact_match",
  );
  assert.equal(
    classifyAnchor("the best breaking news pakistan site", "livenewsof.com", BRANDS, MONEY),
    "partial_match",
  );
});

test("classifyAnchor handles generic, empty and image anchors", () => {
  assert.equal(classifyAnchor("click here", "livenewsof.com", BRANDS, MONEY), "generic");
  assert.equal(classifyAnchor("", "livenewsof.com", BRANDS, MONEY), "empty");
  assert.equal(classifyAnchor(null, "livenewsof.com", BRANDS, MONEY), "empty");
  assert.equal(classifyAnchor("[img] Logo", "livenewsof.com", BRANDS, MONEY), "image");
});

test("brand classification wins over keyword classification", () => {
  // A brand mention alongside a keyword is still a brand anchor, not exact-match.
  assert.equal(
    classifyAnchor("Live News Of sports news", "livenewsof.com", BRANDS, MONEY),
    "brand",
  );
});

function vocab(terms: [string, number][]): Vocabulary {
  return { terms: new Map(terms), source: "manual", updatedAt: "" };
}

test("scoreRelevance rewards on-topic text and returns zero with no vocabulary", () => {
  const v = vocab([
    ["cricket", 1],
    ["pakistan", 0.8],
    ["election", 0.6],
  ]);
  const on = scoreRelevance("Pakistan cricket team wins the election-week series", v);
  const off = scoreRelevance("A recipe for sourdough bread using a starter", v);
  assert.ok(on.score > off.score);
  assert.ok(on.matchedTerms.includes("cricket"));

  const empty = scoreRelevance("anything", vocab([]));
  assert.equal(empty.score, 0);
});

test("scoreRelevance weights title matches above body matches", () => {
  // A wide vocabulary keeps coverage well below the clamp, so the 2x title
  // boost is actually observable rather than saturating at 100.
  const v = vocab(
    Array.from({ length: 20 }, (_, i) => [`term${i}`, 1] as [string, number]),
  );
  const titled = scoreRelevance("unrelated body prose", v, { title: "term0 report" });
  const bodyOnly = scoreRelevance("term0 appears in the body", v, { title: "untitled" });
  assert.ok(
    titled.score > bodyOnly.score,
    `title ${titled.score} should beat body ${bodyOnly.score}`,
  );
});

test("vocabularyFromText suppresses boilerplate that appears on every page", () => {
  const terms = vocabularyFromText([
    "cricket match report pakistan cookie policy navigation",
    "election results analysis pakistan cookie policy navigation",
    "weather forecast update pakistan cookie policy navigation",
  ]);
  const byTerm = new Map(terms.map((t) => [t.term, t.weight]));
  // "cookie" is on every page; distinctive terms should outrank it.
  const cookie = byTerm.get("cookie") ?? 0;
  const cricket = byTerm.get("cricket") ?? 0;
  assert.ok(cricket > cookie, `cricket ${cricket} should beat cookie ${cookie}`);
});

test("prospectPriority weights relevance above authority", () => {
  const relevant = prospectPriority({
    authority: 20,
    relevance: 90,
    spamScore: 0,
    difficulty: 40,
  });
  const authoritative = prospectPriority({
    authority: 90,
    relevance: 20,
    spamScore: 0,
    difficulty: 40,
  });
  assert.ok(relevant > authoritative);
});

test("prospectPriority penalises toxic prospects hard", () => {
  const clean = prospectPriority({ authority: 50, relevance: 70, spamScore: 0, difficulty: 40 });
  const toxic = prospectPriority({ authority: 50, relevance: 70, spamScore: 80, difficulty: 40 });
  assert.ok(toxic < clean / 2, `toxic ${toxic} should be far below clean ${clean}`);
  assert.ok(toxic >= 0);
});

test("estimateDifficulty makes unlinked mentions easiest and big sites hardest", () => {
  const mention = estimateDifficulty({
    kind: "unlinked_mention",
    authority: 30,
    hasContact: true,
    isUnlinkedMention: true,
  });
  const bigGap = estimateDifficulty({
    kind: "competitor_gap",
    authority: 95,
    hasContact: false,
    isUnlinkedMention: false,
  });
  assert.ok(mention < bigGap);
  assert.ok(mention >= 1 && bigGap <= 100);
});

test("normaliseRankPosition maps rank positions onto a 0-100 scale", () => {
  const top = normaliseRankPosition(1, 1_000_000);
  const mid = normaliseRankPosition(1000, 1_000_000);
  const tail = normaliseRankPosition(999_999, 1_000_000);
  assert.equal(top, 100);
  assert.ok(mid > tail && mid < top);
  assert.equal(normaliseRankPosition(0, 1000), 0);
  assert.equal(normaliseRankPosition(Number.NaN, 1000), 0);
});

test("unreverseHost converts the webgraph's reversed host format", () => {
  assert.equal(unreverseHost("com.example.www"), "example.com");
  assert.equal(unreverseHost("uk.co.bbc.news"), "news.bbc.co.uk");
  assert.equal(unreverseHost("single"), null);
});

test("parseCsv handles quotes, embedded delimiters and newlines", () => {
  const rows = parseCsv('a,b\n"has,comma","has ""quotes"""\n"multi\nline",x');
  assert.deepEqual(rows[1], ["has,comma", 'has "quotes"']);
  assert.deepEqual(rows[2], ["multi\nline", "x"]);
});

test("parseCsv strips a BOM and handles CRLF", () => {
  const rows = parseCsv("﻿a,b\r\n1,2\r\n");
  assert.deepEqual(rows[0], ["a", "b"]);
  assert.deepEqual(rows[1], ["1", "2"]);
});

test("detectDelimiter finds semicolons from European Excel exports", () => {
  assert.equal(detectDelimiter("a;b;c\n1;2;3"), ";");
  assert.equal(detectDelimiter("a,b,c\n1,2,3"), ",");
  assert.equal(detectDelimiter("a\tb\n1\t2"), "\t");
});

test("parseCsvObjects normalises header names", () => {
  const objs = parseCsvObjects("Referring Page URL,Anchor\nhttps://x.com/a,Hello");
  assert.equal(objs[0]!.referring_page_url, "https://x.com/a");
  assert.equal(objs[0]!.anchor, "Hello");
});

test("toCsv quotes fields that need it and round-trips", () => {
  const csv = toCsv([
    ["a", "b"],
    ['has,comma', 'has "quote"'],
  ]);
  const back = parseCsv(csv);
  assert.deepEqual(back[1], ["has,comma", 'has "quote"']);
});

test("classifyUrlOpportunity recognises resource and contribution paths", () => {
  assert.equal(classifyUrlOpportunity("https://x.com/resources/"), "resource_page");
  assert.equal(classifyUrlOpportunity("https://x.com/useful-links.html"), "resource_page");
  assert.equal(classifyUrlOpportunity("https://x.com/write-for-us"), "guest_post");
  assert.equal(classifyUrlOpportunity("https://x.com/news/story-123"), null);
});

test("buildDisavow only includes domains recommended for disavow", () => {
  const file = buildDisavow([
    {
      domain: "toxic.xyz",
      score: 85,
      band: "toxic",
      recommendation: "disavow",
      signals: [
        { id: "a", label: "PBN footprint", weight: 20 },
        { id: "b", label: "Link farm", weight: 20 },
      ],
    },
    {
      domain: "fine.com",
      score: 5,
      band: "clean",
      recommendation: "keep",
      signals: [],
    },
  ]);

  assert.equal(file.stats.domains, 1);
  assert.ok(file.content.includes("domain:toxic.xyz"));
  assert.equal(file.content.includes("fine.com"), false);
  // Every entry carries its justification as a comment.
  assert.ok(file.content.includes("# score 85"));
});

test("buildDisavow honours the allowlist even for toxic domains", () => {
  const file = buildDisavow(
    [
      {
        domain: "partner.xyz",
        score: 95,
        band: "toxic",
        recommendation: "disavow",
        signals: [
          { id: "a", label: "x", weight: 20 },
          { id: "b", label: "y", weight: 20 },
        ],
      },
    ],
    { allowlist: ["partner.xyz"] },
  );
  assert.equal(file.stats.domains, 0);
  assert.equal(file.stats.excluded, 1);
});

test("buildDisavow respects the minimum score floor", () => {
  const assessment = {
    domain: "borderline.com",
    score: 50,
    band: "high" as const,
    recommendation: "review" as const,
    signals: [
      { id: "a", label: "x", weight: 20 },
      { id: "b", label: "y", weight: 20 },
    ],
  };
  // includeReview alone is not enough when the score is under minScore.
  assert.equal(buildDisavow([assessment], { includeReview: true }).stats.domains, 0);
  assert.equal(
    buildDisavow([assessment], { includeReview: true, minScore: 45 }).stats.domains,
    1,
  );
});
