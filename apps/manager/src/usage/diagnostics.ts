import type { WorkerObservability } from "@appflare/cf-api";
import { z } from "zod";

export const diagnosticsInput = z.object({ installId: z.string().min(1).optional() });
export const diagnosticsChange = diagnosticsInput.extend({
  workerName: z.string().min(1).optional(),
  feature: z.enum(["logs", "traces", "issues"]),
  enabled: z.boolean(),
  sampling: z.number().finite().min(0).max(1).default(0.1),
});

/** Change one feature without resetting the other features or provider extensions. */
export function diagnosticSettings(
  previous: WorkerObservability | null | undefined,
  feature: "logs" | "traces" | "issues",
  enabled: boolean,
  sampling = 0.1,
): WorkerObservability {
  const block: WorkerObservability = {
    ...previous,
    enabled: previous?.enabled === true || enabled,
  };
  // A disabled master switch also disables nested settings. Turning on one
  // feature must not revive the other nested settings it previously masked.
  if (previous?.enabled !== true) {
    block.logs = { ...previous?.logs, enabled: false, invocation_logs: false };
    block.traces = { ...previous?.traces, enabled: false };
    if (previous?.issues) block.issues = { ...previous.issues, enabled: false };
  }
  if (feature === "logs") {
    block.logs = {
      ...block.logs,
      enabled,
      invocation_logs: enabled
        ? (previous?.logs?.invocation_logs ?? true)
        : (block.logs?.invocation_logs ?? false),
    };
  } else if (feature === "traces") {
    block.traces = { ...block.traces, enabled, persist: true, head_sampling_rate: sampling };
  } else {
    block.issues = { ...block.issues, enabled };
  }
  return block;
}

export const TRACE_SETUP_HELP =
  "In Cloudflare, open this domain's Observability > Traces. Set the default sample rate to 0%, enable persistence, and add a rule for this exact hostname at 10%. Existing tracing rules should be preserved. Tracing permissions may need to be granted separately.";
