import type { Metadata } from "next";
import Link from "next/link";
import { config } from "@/lib/config";
import "./globals.css";

export const metadata: Metadata = {
  title: "LinkForge — backlink audit, prospecting and outreach",
  description:
    "Self-hosted backlink toolkit: crawl and verify links, score toxicity, generate disavow files, find link opportunities and run outreach.",
};

const NAV = [
  { href: "/", label: "Overview" },
  { href: "/links", label: "Backlinks" },
  { href: "/audit", label: "Audit" },
  { href: "/anchors", label: "Anchors" },
  { href: "/opportunities", label: "Opportunities" },
  { href: "/outreach", label: "Outreach" },
  { href: "/jobs", label: "Jobs" },
  { href: "/settings", label: "Settings" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
          <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
            <div>
              <Link href="/" className="text-lg font-semibold tracking-tight">
                LinkForge
              </Link>
              <p className="mt-0.5 text-xs text-ink-500 dark:text-ink-400">
                Building links for{" "}
                <span className="font-medium text-ink-700 dark:text-ink-300">
                  {config.targetSite}
                </span>
              </p>
            </div>
            <nav className="table-scroll">
              <ul className="flex gap-1">
                {NAV.map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className="block whitespace-nowrap rounded-lg px-3 py-1.5 text-sm text-ink-600 transition hover:bg-ink-100 hover:text-ink-900 dark:text-ink-400 dark:hover:bg-ink-800 dark:hover:text-ink-100"
                    >
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          </header>
          <main>{children}</main>
          <footer className="mt-12 border-t border-ink-200 pt-4 text-xs text-ink-400 dark:border-ink-800">
            Crawls run as{" "}
            <code className="rounded bg-ink-100 px-1 dark:bg-ink-800">
              {config.crawler.userAgent}
            </code>{" "}
            with a {config.crawler.hostDelayMs}ms per-host delay and robots.txt
            compliance.
          </footer>
        </div>
      </body>
    </html>
  );
}
