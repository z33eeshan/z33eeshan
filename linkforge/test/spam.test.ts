import assert from "node:assert/strict";
import { test } from "node:test";
import {
  anchorConcentration,
  assessDomain,
  bandFor,
  combine,
  labelEntropy,
  type DomainFacts,
} from "@/lib/engine/spam";

function facts(over: Partial<DomainFacts> = {}): DomainFacts {
  return {
    domain: "example.com",
    authority: 25,
    linkingPages: 1,
    totalLinks: 1,
    followRatio: 1,
    anchorTexts: ["Example Brand"],
    positions: ["content"],
    outboundLinkCount: 20,
    language: "en",
    siteLanguage: "en",
    title: "A Real News Site — Latest Coverage",
    wordCount: 900,
    httpStatus: 200,
    isIndexable: true,
    avgPathDepth: 2,
    networkNeighbours: 0,
    ...over,
  };
}

test("a normal editorial link scores clean", () => {
  const a = assessDomain(facts());
  assert.equal(a.band, "clean");
  assert.equal(a.recommendation, "keep");
});

test("a high-authority domain is not condemned by weak signals alone", () => {
  const a = assessDomain(
    facts({ authority: 70, domain: "big.xyz", language: "de", siteLanguage: "en" }),
  );
  // Risky TLD + language mismatch are weak; established authority offsets them.
  assert.ok(a.score < 25, `expected a low score, got ${a.score}`);
  assert.equal(a.recommendation, "keep");
});

test("a classic PBN pattern scores toxic and is recommended for disavow", () => {
  const a = assessDomain(
    facts({
      domain: "x7kqz9vbn.xyz",
      authority: 1,
      linkingPages: 40,
      totalLinks: 40,
      followRatio: 1,
      anchorTexts: Array.from({ length: 40 }, () => "cheap insurance quotes"),
      positions: Array.from({ length: 40 }, () => "footer"),
      outboundLinkCount: 450,
      title: "Just another WordPress site",
      wordCount: 80,
      isIndexable: false,
      networkNeighbours: 12,
    }),
  );
  assert.equal(a.band, "toxic");
  assert.equal(a.recommendation, "disavow");

  const ids = a.signals.map((s) => s.id);
  for (const expected of [
    "sitewide_footer",
    "anchor_concentration",
    "money_anchor",
    "link_farm",
    "pbn_footprint",
    "network_cluster",
  ]) {
    assert.ok(ids.includes(expected), `expected signal ${expected}`);
  }
});

test("gambling content fires its signal but one signal alone is not a disavow", () => {
  const a = assessDomain(facts({ title: "Best Online Casino Bonuses 2026", authority: 3 }));
  assert.ok(
    a.signals.some((s) => s.id === "adult_gambling_pharma"),
    "the content-category signal must fire",
  );
  assert.ok(a.score > 0, "it must move the score off clean");
  // By design, a lone signal never reaches disavow — a long-form article about
  // the gambling industry would trip the same title match.
  assert.notEqual(a.recommendation, "disavow");
});

test("gambling content plus a second signal does reach disavow", () => {
  const a = assessDomain(
    facts({
      title: "Best Online Casino Bonuses 2026",
      authority: 2,
      linkingPages: 30,
      totalLinks: 30,
      anchorTexts: Array.from({ length: 30 }, () => "casino bonus"),
      positions: Array.from({ length: 30 }, () => "footer"),
      outboundLinkCount: 400,
      wordCount: 90,
    }),
  );
  assert.equal(a.band, "toxic");
  assert.equal(a.recommendation, "disavow");
});

test("mitigating signals temper a score but cannot erase a decisive one", () => {
  const strong = assessDomain(
    facts({
      title: "Buy Cheap Viagra Online",
      authority: 60,
      wordCount: 1200,
      positions: ["content"],
      linkingPages: 1,
    }),
  );
  // Established authority, a long page and an editorial placement all push down,
  // but they must not cancel a pharma-content hit to nothing.
  assert.ok(strong.score > 0, `relief must be capped, got ${strong.score}`);
});

test("disavow requires two or more substantial signals", () => {
  // One heavy signal, nothing else: high score is possible but not a disavow.
  const single = assessDomain(
    facts({ authority: null, title: "Buy Viagra Cheap", wordCount: 900 }),
  );
  const heavy = single.signals.filter((s) => s.weight > 8).length;
  if (heavy < 2) {
    assert.notEqual(single.recommendation, "disavow");
  }
});

test("combine has diminishing returns and clamps to 0-100", () => {
  const many = Array.from({ length: 12 }, (_, i) => ({
    id: `s${i}`,
    label: "x",
    weight: 25,
  }));
  const total = combine(many);
  assert.ok(total <= 100, `score must clamp, got ${total}`);
  // 12 x 25 = 300 raw; diminishing returns must pull it well under that.
  assert.ok(total > 60);

  // Five weak signals should not outrank one decisive one plus a second.
  const weak = combine(
    Array.from({ length: 5 }, (_, i) => ({ id: `w${i}`, label: "x", weight: 6 })),
  );
  const strong = combine([
    { id: "a", label: "x", weight: 25 },
    { id: "b", label: "x", weight: 22 },
  ]);
  assert.ok(strong > weak);
});

test("mitigation is capped at half the positive subtotal", () => {
  // One +6 signal against a huge -25 mitigation: relief caps at -3, not -25.
  const capped = combine([
    { id: "a", label: "x", weight: 6 },
    { id: "mitigate", label: "y", weight: -25 },
  ]);
  assert.equal(capped, 3);

  // A mitigation smaller than the cap applies in full.
  const partial = combine([
    { id: "a", label: "x", weight: 20 },
    { id: "mitigate", label: "y", weight: -4 },
  ]);
  assert.equal(partial, 16);
});

test("a score with no positive signals is zero, not negative", () => {
  assert.equal(combine([{ id: "mitigate", label: "y", weight: -25 }]), 0);
  assert.equal(combine([]), 0);
});

test("bandFor maps scores to bands at the documented thresholds", () => {
  assert.equal(bandFor(0), "clean");
  assert.equal(bandFor(9.9), "clean");
  assert.equal(bandFor(10), "low");
  assert.equal(bandFor(25), "medium");
  assert.equal(bandFor(45), "high");
  assert.equal(bandFor(70), "toxic");
  assert.equal(bandFor(100), "toxic");
});

test("anchorConcentration measures the dominant anchor share", () => {
  assert.equal(anchorConcentration([]), 0);
  assert.equal(anchorConcentration(["only one"]), 0);
  assert.equal(anchorConcentration(["a", "a", "a", "a"]), 1);
  assert.equal(anchorConcentration(["a", "a", "b", "c"]), 0.5);
  // Case and padding must not create false variety.
  assert.equal(anchorConcentration([" A ", "a", "a"]), 1);
});

test("labelEntropy separates real words from generated strings", () => {
  assert.ok(labelEntropy("x7kqz9vbnw") > labelEntropy("guardian"));
  // Very short labels are not judged.
  assert.equal(labelEntropy("bbc"), 0);
});
