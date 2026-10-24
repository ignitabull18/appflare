import { reset } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { createClient } from "@appflare/cf-api";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMigrator } from "../db/migrate";
import { migrations } from "../db/migrations/index";
import { seedInstall } from "../test/seed-install";

const { requireRole, getCfClient } = vi.hoisted(() => ({
  requireRole: vi.fn(),
  getCfClient: vi.fn(),
}));
vi.mock("@tanstack/react-start", () => {
  const chain = { validator: () => chain, handler: (fn: unknown) => fn };
  return { createServerFn: () => chain };
});
vi.mock("@tanstack/react-start/server", () => ({
  getRequest: () => new Request("https://appflare.example.com"),
}));
vi.mock("../server/auth.server", () => ({ requireRole }));
vi.mock("../cloudflare/client.server", () => ({ getCfClient }));
const { changeDiagnostics, changeHostnameTracing } = await import("./diagnostics.functions");
const change = changeDiagnostics as unknown as (args: {
  data: {
    installId: string;
    workerName: string;
    feature: "traces";
    enabled: boolean;
    sampling: number;
  };
}) => Promise<unknown>;
const hostname = changeHostnameTracing as unknown as (args: {
  data: { installId: string; enabled: boolean };
}) => Promise<unknown>;
const input = {
  data: {
    installId: "i1",
    workerName: "cut",
    feature: "traces" as const,
    enabled: true,
    sampling: 0.1,
  },
};

beforeEach(async () => {
  await reset();
  await createMigrator(migrations).ensure(env.DB);
  requireRole.mockReset().mockResolvedValue(undefined);
  getCfClient.mockReset();
  await seedInstall({ resources: [{ kind: "worker", name: "cut", cfId: "cut" }] });
  await env.DB.prepare(
    "UPDATE installs SET served_domain = 'cut.example.com' WHERE id = 'i1'",
  ).run();
});

function world(existingBroadRule = false, enabled = true) {
  let block = {
    enabled: true,
    logs: { enabled: true, persist: true, head_sampling_rate: 0.5 },
    issues: { enabled: true },
    traces: { enabled: false, head_sampling_rate: 0.25 },
  };
  let rules = existingBroadRule
    ? [
        {
          action: "set_trace_settings",
          action_parameters: { sampling_ratio: 0.7 },
          enabled: true,
          expression: "true",
          description: "Someone else's rule",
        },
      ]
    : [];
  const calls: { method: string; path: string; body: unknown }[] = [];
  getCfClient.mockResolvedValue(
    createClient({
      accountId: "account",
      token: "test",
      fetch: async (request, init) => {
        const path = new URL(String(request)).pathname;
        const method = init?.method ?? "GET";
        const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
        calls.push({ method, path, body });
        const answer = (result: unknown) =>
          Response.json({ success: true, result, errors: [], messages: [] });
        if (method === "GET" && path.endsWith("/script-settings"))
          return answer({ observability: block });
        if (path.endsWith("/script-settings")) {
          block = body.observability;
          return answer({});
        }
        if (path.endsWith("/zones")) return answer([{ id: "zone", name: "example.com" }]);
        if (path.endsWith("/tracing/settings"))
          return answer({ enabled, persist: true, sampling_ratio: 0 });
        if (path.endsWith("/tracing/rules")) {
          if (method === "PUT") rules = body.rules;
          return answer({ rules });
        }
        throw new Error(`Unexpected request ${method} ${path}`);
      },
    }),
  );
  return { calls, rules: () => rules, block: () => block };
}

describe("diagnostic controls", () => {
  it("requires an admin before API access", async () => {
    const fake = world();
    requireRole.mockRejectedValue(new Error("permission denied"));
    await expect(change(input)).rejects.toThrow("permission denied");
    expect(fake.calls).toEqual([]);
  });
  it("refuses an unrelated Worker before changing anything", async () => {
    const fake = world();
    await expect(change({ data: { ...input.data, workerName: "unrelated" } })).rejects.toThrow(
      "does not belong",
    );
    expect(fake.calls).toEqual([]);
  });
  it("changes traces without resetting logs or Issues", async () => {
    const fake = world();
    await change(input);
    expect(fake.block()).toMatchObject({
      logs: { enabled: true, persist: true, head_sampling_rate: 0.5 },
      issues: { enabled: true },
      traces: { enabled: true, head_sampling_rate: 0.1 },
    });
  });
  it("preserves other trace rules and scopes its rule to the exact hostname", async () => {
    const fake = world(true);
    await hostname({ data: { installId: "i1", enabled: true } });
    expect(fake.rules()).toHaveLength(2);
    expect(fake.rules()[0]).toMatchObject({
      expression: '(http.host eq "cut.example.com")',
      action_parameters: { sampling_ratio: 0.1 },
    });
    expect(fake.rules()[1]).toMatchObject({
      description: "Someone else's rule",
      expression: "true",
    });
  });
  it("uses a zero-sample exact-host override when disabling, preserving broader rules", async () => {
    const fake = world(true);
    await hostname({ data: { installId: "i1", enabled: false } });
    expect(fake.rules()[0]).toMatchObject({
      enabled: true,
      expression: '(http.host eq "cut.example.com")',
      action_parameters: { sampling_ratio: 0 },
    });
    expect(fake.rules()[1]).toMatchObject({ description: "Someone else's rule" });
  });
  it("refuses to activate unrelated rules in an inactive zone", async () => {
    const fake = world(true, false);
    await expect(hostname({ data: { installId: "i1", enabled: true } })).rejects.toThrow(
      "other existing rules",
    );
    expect(fake.calls.every((call) => call.method === "GET")).toBe(true);
  });
});
