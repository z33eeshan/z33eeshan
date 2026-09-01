/**
 * Standalone job worker. Run alongside `npm run dev` (or in production) so
 * long crawls execute outside the web request path:
 *
 *   npm run worker
 *
 * The dashboard also kicks an in-process runner, so this is optional in
 * development — but it is the right way to run crawls that take a while.
 */

import { claimNext, runJob } from "@/lib/jobs";
import { migrate, db } from "@/lib/db";

const POLL_MS = 2000;
let stopping = false;

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    console.log(`\n${signal} received — finishing current job, then exiting.`);
    stopping = true;
  });
}

async function main(): Promise<void> {
  migrate(db());
  console.log("LinkForge worker started. Polling for jobs...");

  while (!stopping) {
    const job = claimNext();
    if (!job) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      continue;
    }
    console.log(`[${job.id}] ${job.kind} started`);
    const started = Date.now();
    await runJob(job);
    console.log(`[${job.id}] ${job.kind} finished in ${Math.round((Date.now() - started) / 1000)}s`);
  }

  console.log("Worker stopped.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
