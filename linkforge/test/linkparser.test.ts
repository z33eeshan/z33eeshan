import assert from "node:assert/strict";
import { test } from "node:test";
import { findLinksTo, parsePage } from "@/lib/engine/linkparser";

const PAGE = `<!doctype html>
<html lang="en-GB">
<head>
  <title>Test Article</title>
  <meta name="description" content="A test page">
  <link rel="canonical" href="https://source.com/article">
  <meta name="robots" content="index,follow">
</head>
<body>
  <nav><a href="/home">Home</a><a href="https://target.com/nav">Nav link</a></nav>
  <article class="entry-content">
    <p>Some genuine prose about the topic, citing
      <a href="https://target.com/story">Live News Of</a> as a source.</p>
    <p>Also see <a href="https://other.com/x" rel="nofollow sponsored">a paid link</a>.</p>
    <p><a href="https://target.com/img"><img src="/x.png" alt="Target logo"></a></p>
  </article>
  <aside class="sidebar"><a href="https://target.com/side">Sidebar</a></aside>
  <div id="comments"><a href="https://spam.com/c" rel="ugc">comment link</a></div>
  <footer><a href="https://target.com/footer">Footer</a><a href="/contact">Contact us</a></footer>
  <p>Reach the editor at editor@source.com or noreply@source.com.</p>
  <script>var x = "<a href='https://ignored.com'>no</a>";</script>
</body>
</html>`;

const page = parsePage(PAGE, "https://source.com/article");

test("extracts page metadata", () => {
  assert.equal(page.title, "Test Article");
  assert.equal(page.metaDescription, "A test page");
  assert.equal(page.canonical, "https://source.com/article");
  assert.equal(page.language, "en-gb");
  assert.equal(page.isIndexable, true);
});

test("noindex is detected", () => {
  const p = parsePage(
    `<html><head><meta name="robots" content="noindex,nofollow"></head><body>x</body></html>`,
    "https://x.com/",
  );
  assert.equal(p.isIndexable, false);
});

test("script content is not treated as links or body text", () => {
  assert.equal(
    page.links.some((l) => l.href.includes("ignored.com")),
    false,
  );
  assert.equal(page.bodyText.includes("var x"), false);
});

test("internal and external links are counted separately", () => {
  // Internal: /home and /contact.
  assert.equal(page.internalLinkCount, 2);
  assert.equal(page.externalDomains.sort().join(","), "other.com,spam.com,target.com");
});

test("rel attributes are parsed into flags", () => {
  const paid = page.links.find((l) => l.href.includes("other.com"))!;
  assert.equal(paid.isNofollow, true);
  assert.equal(paid.isSponsored, true);
  assert.equal(paid.isUgc, false);

  const comment = page.links.find((l) => l.href.includes("spam.com"))!;
  assert.equal(comment.isUgc, true);
});

test("link position is classified from the containing region", () => {
  const byPath = (p: string) => page.links.find((l) => l.href.endsWith(p))!;
  assert.equal(byPath("/nav").position, "nav");
  assert.equal(byPath("/story").position, "content");
  assert.equal(byPath("/side").position, "sidebar");
  assert.equal(byPath("/footer").position, "footer");
  assert.equal(byPath("/c").position, "comment");
});

test("image links fall back to alt text", () => {
  const img = page.links.find((l) => l.href.endsWith("/img"))!;
  assert.equal(img.isImageLink, true);
  assert.equal(img.anchorText, "[img] Target logo");
});

test("surrounding text captures the sentence around the link", () => {
  const story = page.links.find((l) => l.href.endsWith("/story"))!;
  assert.ok(story.surroundingText.includes("genuine prose about the topic"));
});

test("emails are extracted and boilerplate addresses filtered out", () => {
  assert.ok(page.emails.includes("editor@source.com"));
  assert.equal(page.emails.includes("noreply@source.com"), false);
});

test("contact page presence is detected", () => {
  assert.equal(page.hasContactPage, true);
});

test("findLinksTo matches on registrable domain across subdomains", () => {
  // nav, content, image, sidebar and footer placements all count.
  const hits = findLinksTo(page, "target.com");
  assert.equal(hits.length, 5);

  const sub = parsePage(
    `<html><body><a href="https://www.target.com/x">x</a></body></html>`,
    "https://source.com/",
  );
  assert.equal(findLinksTo(sub, "target.com").length, 1);
});

test("relative hrefs resolve against the page URL", () => {
  const p = parsePage(
    `<html><body><a href="/deep/page">x</a></body></html>`,
    "https://source.com/blog/post",
  );
  assert.equal(p.links[0]!.href, "https://source.com/deep/page");
});
