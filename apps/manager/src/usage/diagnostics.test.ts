import { describe, expect, it } from "vitest";
import { diagnosticSettings, diagnosticsChange } from "./diagnostics";

describe("diagnostics settings", () => {
  it("preserves traces, Issues and unknown settings when logs change", () => {
    const before = {
      enabled: true,
      issues: { enabled: true },
      traces: { enabled: true, head_sampling_rate: 0.1 },
      redact_query_string: true,
    };
    const after = diagnosticSettings(before, "logs", false);
    expect(after).toMatchObject({ ...before, logs: { enabled: false } });
    expect(before).not.toHaveProperty("logs");
  });
  it("does not implicitly enable logs for a new trace-only configuration", () => {
    expect(diagnosticSettings(null, "traces", true)).toMatchObject({
      enabled: true,
      logs: { enabled: false },
      traces: { enabled: true, persist: true, head_sampling_rate: 0.1 },
    });
  });
  it("preserves log destinations and sampling", () => {
    const logs = {
      enabled: true,
      invocation_logs: true,
      destinations: ["existing"],
      head_sampling_rate: 0.25,
    };
    expect(diagnosticSettings({ enabled: true, logs }, "issues", true).logs).toEqual(logs);
  });
  it("does not revive nested features hidden by a disabled master switch", () => {
    const before = {
      enabled: false,
      logs: { enabled: true, invocation_logs: true, head_sampling_rate: 0.5 },
      traces: { enabled: true },
      issues: { enabled: true },
    };
    expect(diagnosticSettings(before, "traces", true)).toMatchObject({
      enabled: true,
      logs: { enabled: false, head_sampling_rate: 0.5 },
      traces: { enabled: true },
      issues: { enabled: false },
    });
    expect(diagnosticSettings(before, "logs", true)).toMatchObject({
      enabled: true,
      traces: { enabled: false },
      issues: { enabled: false },
    });
  });
  it("leaves a disabled master switch off when disabling a feature", () => {
    expect(diagnosticSettings({ enabled: false }, "logs", false).enabled).toBe(false);
  });
  it("rejects invalid sampling and unknown controls", () => {
    expect(
      diagnosticsChange.safeParse({ feature: "traces", enabled: true, sampling: 2 }).success,
    ).toBe(false);
    expect(diagnosticsChange.safeParse({ feature: "security", enabled: false }).success).toBe(
      false,
    );
  });
});
