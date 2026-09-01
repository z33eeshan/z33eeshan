/**
 * Minimal robots.txt parser covering the parts that actually govern a link
 * crawler: User-agent grouping, Allow/Disallow with `*` and `$` wildcards,
 * Crawl-delay, and Sitemap discovery.
 *
 * Longest-match-wins with Allow breaking ties, per Google's spec.
 */

export interface RobotsRules {
  groups: RobotsGroup[];
  sitemaps: string[];
}

interface RobotsGroup {
  agents: string[];
  rules: { allow: boolean; pattern: string }[];
  crawlDelay?: number;
}

export function parseRobots(body: string): RobotsRules {
  const groups: RobotsGroup[] = [];
  const sitemaps: string[] = [];
  let current: RobotsGroup | null = null;
  // Consecutive User-agent lines share one rule group; a directive line ends
  // the agent run and the next User-agent starts a fresh group.
  let acceptingAgents = false;

  for (const raw of body.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;

    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    switch (field) {
      case "user-agent": {
        if (!current || !acceptingAgents) {
          current = { agents: [], rules: [] };
          groups.push(current);
          acceptingAgents = true;
        }
        if (value) current.agents.push(value.toLowerCase());
        break;
      }
      case "disallow":
      case "allow": {
        if (!current) break;
        acceptingAgents = false;
        // "Disallow:" with an empty value means allow everything; skip it
        // rather than storing a zero-length pattern that matches all paths.
        if (field === "disallow" && value === "") break;
        current.rules.push({ allow: field === "allow", pattern: value });
        break;
      }
      case "crawl-delay": {
        if (!current) break;
        acceptingAgents = false;
        const n = Number.parseFloat(value);
        if (Number.isFinite(n) && n >= 0) current.crawlDelay = n;
        break;
      }
      case "sitemap": {
        if (value) sitemaps.push(value);
        break;
      }
    }
  }

  return { groups, sitemaps };
}

/** Token used for matching, e.g. "LinkForgeBot/0.1 (+url)" -> "linkforgebot". */
export function agentToken(userAgent: string): string {
  return (userAgent.split("/")[0] ?? userAgent).trim().toLowerCase();
}

function selectGroup(rules: RobotsRules, userAgent: string): RobotsGroup | null {
  const token = agentToken(userAgent);
  let wildcard: RobotsGroup | null = null;
  let best: { group: RobotsGroup; len: number } | null = null;

  for (const group of rules.groups) {
    for (const agent of group.agents) {
      if (agent === "*") {
        wildcard ??= group;
        continue;
      }
      // Most specific matching agent wins.
      if (token.includes(agent) && (!best || agent.length > best.len)) {
        best = { group, len: agent.length };
      }
    }
  }
  return best?.group ?? wildcard;
}

function matchPattern(pattern: string, path: string): number {
  // Returns match length (for longest-match precedence) or -1 for no match.
  const anchoredEnd = pattern.endsWith("$");
  const p = anchoredEnd ? pattern.slice(0, -1) : pattern;
  const segments = p.split("*");

  let cursor = 0;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;
    if (seg === "") continue;
    if (i === 0) {
      if (!path.startsWith(seg)) return -1;
      cursor = seg.length;
      continue;
    }
    const found = path.indexOf(seg, cursor);
    if (found === -1) return -1;
    cursor = found + seg.length;
  }

  if (anchoredEnd && cursor !== path.length) {
    // The final literal must land exactly at the end of the path.
    const last = segments[segments.length - 1]!;
    if (last === "" ? false : !path.endsWith(last)) return -1;
    if (last === "") return -1;
  }
  return p.length;
}

export function isAllowed(
  rules: RobotsRules,
  userAgent: string,
  url: string,
): boolean {
  const group = selectGroup(rules, userAgent);
  if (!group || group.rules.length === 0) return true;

  let path: string;
  try {
    const u = new URL(url);
    path = u.pathname + (u.search || "");
  } catch {
    return false;
  }

  let decision: { allow: boolean; len: number } | null = null;
  for (const rule of group.rules) {
    const len = matchPattern(rule.pattern, path);
    if (len < 0) continue;
    if (
      !decision ||
      len > decision.len ||
      // Equal-length Allow beats Disallow.
      (len === decision.len && rule.allow && !decision.allow)
    ) {
      decision = { allow: rule.allow, len };
    }
  }

  return decision ? decision.allow : true;
}

export function crawlDelayFor(
  rules: RobotsRules,
  userAgent: string,
): number | undefined {
  return selectGroup(rules, userAgent)?.crawlDelay;
}
