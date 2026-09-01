import { listJobs } from "@/lib/jobs";
import { Badge, Card, Empty, Td, Th, pct } from "@/components/ui";

export const dynamic = "force-dynamic";

export default function JobsPage() {
  const jobs = listJobs(40);

  return (
    <div className="space-y-6">
      <Card
        title="Jobs"
        subtitle="Crawls run in the background. Run `npm run worker` alongside the dev server for long crawls."
      >
        {jobs.length === 0 ? (
          <Empty title="No jobs run yet">
            Start one from the Overview or Opportunities page.
          </Empty>
        ) : (
          <div className="table-scroll">
            <table className="w-full min-w-[820px] text-xs">
              <thead>
                <tr>
                  <Th>#</Th>
                  <Th>Kind</Th>
                  <Th>Status</Th>
                  <Th className="text-right">Progress</Th>
                  <Th>Result</Th>
                  <Th>Started</Th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => (
                  <tr key={j.id}>
                    <Td className="tabular text-ink-500">{j.id}</Td>
                    <Td className="font-medium">{j.kind.replace(/_/g, " ")}</Td>
                    <Td>
                      <Badge
                        tone={
                          j.status === "done"
                            ? "good"
                            : j.status === "failed"
                              ? "bad"
                              : j.status === "running"
                                ? "info"
                                : "neutral"
                        }
                      >
                        {j.status}
                      </Badge>
                    </Td>
                    <Td className="tabular text-right">
                      {j.total ? `${j.processed}/${j.total}` : pct(j.progress, 0)}
                    </Td>
                    <Td className="max-w-[380px]">
                      {j.error ? (
                        <span className="text-rose-700 dark:text-rose-400">{j.error}</span>
                      ) : (
                        (j.message ?? <span className="text-ink-400">—</span>)
                      )}
                    </Td>
                    <Td className="whitespace-nowrap text-ink-500">
                      {j.startedAt ?? j.createdAt}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
