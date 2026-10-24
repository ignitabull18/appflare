import { and, asc, eq, gt, inArray } from "drizzle-orm";
import { z } from "zod";
import { job_logs, jobs } from "../db/schema";
import { sandboxBinding, sandboxInfo } from "../sandbox/binding";
import { firstLine } from "../sandbox/failure-hint";
import type { JobEnv, StepRunner } from "./run-job";
import { JobError, type JobSteps } from "./steps";

/**
 * Waiting for sandbox builds to be turned on at first need: an install or
 * build started while they were off (see sandbox/auto-enable.server.ts)
 * carries the id of the `sandbox_enable` job its start claimed or joined,
 * and waits for it before its first step that uses the sandbox Worker.
 *
 * Each poll is one step that reads the enable job's row and copies its new
 * log lines (not the API request lines) into this job's log, so the
 * progress shows here too; a `step.sleep` separates polls. The enable job
 * ends by deploying a new version of Appflare with the `SANDBOX` binding.
 * Workflows can retain the pre-connection bindings across sleeps. Automatic
 * setup dependents use the serving manager's SELF RPC surface instead, so
 * info, builds and artifact reads reach its current sandbox binding. A
 * sandbox that was deleted still fails its info check and is waited for.
 */

/** The job params field: the enable job to wait for. */
export const sandboxEnableJobField = z.string().min(1).max(64).optional();

export const SANDBOX_ENABLE_WAIT = {
  /** Seconds between polls while the enable job is queued or running. */
  pollSeconds: 15,
  /**
   * Polls before giving up: 30 minutes. A fresh enable took about two
   * minutes when measured; its container wait alone may take up to about 17.
   */
  maxPolls: 120,
  /** Polls, a minute apart, for the binding after the enable job succeeded. */
  bindingPolls: 5,
  /** Log lines copied per poll. */
  linesPerPoll: 40,
} as const;

interface PollResult {
  status: string;
  lastLogId: number;
  bound: boolean;
}

function pollName(poll: number): string {
  return `wait for sandbox builds (${poll})`;
}

/** Whether `SANDBOX` is bound in this invocation and a call through it answers. */
async function sandboxAnswers(env: JobEnv): Promise<boolean> {
  const binding = sandboxBinding(env);
  if (binding === undefined) return false;
  try {
    await sandboxInfo(binding);
    return true;
  } catch {
    return false;
  }
}

/** Steps "wait for sandbox builds (n)": returns once the enable job succeeded and `SANDBOX` answers. */
export async function awaitSandboxEnabledPhase(
  steps: JobSteps,
  step: StepRunner,
  env: JobEnv,
  enableJobId: string,
): Promise<void> {
  let lastLogId = 0;
  let unboundPolls = 0;
  for (let poll = 1; ; poll++) {
    const seen: PollResult = await steps.run(pollName(poll), async ({ log, orm }) => {
      const [job] = await orm
        .select({ status: jobs.status, error: jobs.error })
        .from(jobs)
        .where(and(eq(jobs.id, enableJobId), eq(jobs.kind, "sandbox_enable")))
        .limit(1);
      if (job === undefined) {
        throw new JobError(`the job ${enableJobId} that turns sandbox builds on is not recorded`);
      }
      if (poll === 1) {
        log.info(
          `Sandbox builds are off, so the job ${enableJobId} turns them on first (about two minutes). Its progress follows.`,
        );
      }
      const lines = await orm
        .select({ id: job_logs.id, level: job_logs.level, message: job_logs.message })
        .from(job_logs)
        .where(
          and(
            eq(job_logs.job_id, enableJobId),
            gt(job_logs.id, lastLogId),
            inArray(job_logs.level, ["info", "warn", "error"]),
          ),
        )
        .orderBy(asc(job_logs.id))
        .limit(SANDBOX_ENABLE_WAIT.linesPerPoll);
      for (const line of lines) log.log(line.level, `Sandbox builds: ${line.message}`);
      if (job.status === "failed") {
        throw new JobError(
          `sandbox builds could not be turned on (job ${enableJobId}): ${firstLine(job.error) ?? "it failed"}; nothing of this job was started`,
        );
      }
      const bound = job.status === "succeeded" && (await sandboxAnswers(env));
      if (bound) {
        log.info("Sandbox builds are on; continuing.");
      }
      return { status: job.status, lastLogId: lines.at(-1)?.id ?? lastLogId, bound };
    });
    lastLogId = seen.lastLogId;
    if (seen.status === "succeeded") {
      if (seen.bound) return;
      unboundPolls += 1;
      if (unboundPolls > SANDBOX_ENABLE_WAIT.bindingPolls) {
        steps.current = "wait for sandbox builds";
        throw new JobError(
          "sandbox builds are on now, but this job still runs on the version of Appflare from before they were connected; start it again",
        );
      }
      // Retry while the serving manager finishes exposing its connected binding.
      await step.sleep(`${pollName(poll)} resume`, "1 minute");
      continue;
    }
    if (poll >= SANDBOX_ENABLE_WAIT.maxPolls) {
      steps.current = "wait for sandbox builds";
      throw new JobError(
        `sandbox builds are still being turned on after ${Math.round((SANDBOX_ENABLE_WAIT.maxPolls * SANDBOX_ENABLE_WAIT.pollSeconds) / 60)} minutes (job ${enableJobId}); start this again once that job has finished`,
      );
    }
    await step.sleep(`${pollName(poll)} pause`, `${SANDBOX_ENABLE_WAIT.pollSeconds} seconds`);
  }
}
