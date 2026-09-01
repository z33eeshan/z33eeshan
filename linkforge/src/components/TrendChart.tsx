"use client";

import { useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { SnapshotRow } from "@/lib/queries";

/**
 * Link profile over time.
 *
 * Three count series on ONE axis. Median authority is deliberately not plotted
 * here: it is a 0-100 score, and putting it on a second y-axis against link
 * counts would let the two scales be set to imply any correlation you like.
 * It gets its own tile instead.
 */
const SERIES = [
  { key: "referringDomains", label: "Referring domains", color: "var(--series-1)" },
  { key: "liveBacklinks", label: "Live backlinks", color: "var(--series-2)" },
  { key: "lostBacklinks", label: "Lost backlinks", color: "var(--series-3)" },
] as const;

type SeriesKey = (typeof SERIES)[number]["key"];

function shortDate(iso: string): string {
  const d = new Date(iso.replace(" ", "T"));
  return Number.isNaN(d.getTime())
    ? iso.slice(0, 10)
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function TrendChart({ data }: { data: SnapshotRow[] }) {
  const [showTable, setShowTable] = useState(false);

  const chartData = data.map((d) => ({
    date: shortDate(d.takenAt),
    referringDomains: d.referringDomains,
    liveBacklinks: d.liveBacklinks,
    lostBacklinks: d.lostBacklinks,
    medianAuthority: d.medianAuthority,
  }));

  const last = chartData.at(-1);

  return (
    <div className="viz-root">
      {/* Legend is always present for multiple series, so identity is never
          carried by colour alone. */}
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        {SERIES.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5 text-xs">
            <span
              aria-hidden
              className="inline-block h-0.5 w-4 rounded-full"
              style={{ background: s.color }}
            />
            <span className="text-ink-600 dark:text-ink-400">{s.label}</span>
            {last && (
              <span className="tabular font-medium text-ink-900 dark:text-ink-100">
                {Number(last[s.key as SeriesKey] ?? 0).toLocaleString()}
              </span>
            )}
          </span>
        ))}
        <button
          type="button"
          onClick={() => setShowTable((v) => !v)}
          className="ml-auto rounded-md border border-ink-300 px-2 py-0.5 text-[11px] text-ink-600 hover:bg-ink-100 dark:border-ink-700 dark:text-ink-400 dark:hover:bg-ink-800"
        >
          {showTable ? "Hide table" : "View as table"}
        </button>
      </div>

      <div style={{ width: "100%", height: 260 }}>
        <ResponsiveContainer>
          <LineChart data={chartData} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
            <CartesianGrid stroke="var(--viz-grid)" vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 11, fill: "var(--viz-axis)" }}
              stroke="var(--viz-grid)"
              tickLine={false}
              minTickGap={24}
            />
            <YAxis
              tick={{ fontSize: 11, fill: "var(--viz-axis)" }}
              stroke="var(--viz-grid)"
              tickLine={false}
              axisLine={false}
              width={48}
            />
            <Tooltip
              cursor={{ stroke: "var(--viz-axis)", strokeWidth: 1 }}
              contentStyle={{
                background: "var(--surface-1)",
                border: "1px solid var(--viz-grid)",
                borderRadius: 8,
                fontSize: 12,
                color: "var(--viz-text)",
              }}
              labelStyle={{ color: "var(--viz-text)", fontWeight: 600 }}
              formatter={(value: number | string, name: string) => {
                const series = SERIES.find((s) => s.key === name);
                return [Number(value).toLocaleString(), series?.label ?? name];
              }}
            />
            {SERIES.map((s) => (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                stroke={s.color}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--surface-1)" }}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      {showTable && (
        <div className="table-scroll mt-4">
          <table className="w-full min-w-[520px] text-xs">
            <thead>
              <tr>
                <th className="px-2 py-1.5 text-left font-semibold text-ink-500">Date</th>
                {SERIES.map((s) => (
                  <th key={s.key} className="px-2 py-1.5 text-right font-semibold text-ink-500">
                    {s.label}
                  </th>
                ))}
                <th className="px-2 py-1.5 text-right font-semibold text-ink-500">
                  Median authority
                </th>
              </tr>
            </thead>
            <tbody>
              {[...chartData].reverse().map((row, i) => (
                <tr key={`${row.date}-${i}`} className="border-t border-ink-100 dark:border-ink-800">
                  <td className="px-2 py-1.5">{row.date}</td>
                  {SERIES.map((s) => (
                    <td key={s.key} className="tabular px-2 py-1.5 text-right">
                      {Number(row[s.key as SeriesKey] ?? 0).toLocaleString()}
                    </td>
                  ))}
                  <td className="tabular px-2 py-1.5 text-right">
                    {row.medianAuthority == null ? "—" : row.medianAuthority.toFixed(1)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
