import { type ContainerApplication, createClient } from "@appflare/cf-api";
import { containerRuntimeSchema } from "@appflare/schema";
import { describe, expect, it } from "vitest";
import { configureContainerPhase } from "./container-app";
import { StepLog } from "./step-log";
import type { StepTools } from "./steps";

const runtime = containerRuntimeSchema.parse({
  image: `docker.io/library/nginx@sha256:${"a".repeat(64)}`,
  port: 80,
  architecture: "linux/amd64",
});

function world(app: ContainerApplication | null = null, rolloutStatus = "completed") {
  let current = app;
  const calls: string[] = [];
  const api = createClient({
    accountId: "test-account",
    token: "test-token",
    fetch: async (request, init) => {
      const path = new URL(String(request)).pathname;
      const method = init?.method ?? "GET";
      calls.push(`${method} ${path}`);
      const answer = (result: unknown) =>
        Response.json({ success: true, result, errors: [], messages: [] });
      if (path.endsWith("/workers/durable_objects/namespaces"))
        return answer([{ id: "ns", script: "demo", class: "AppContainer" }]);
      if (path.endsWith("/containers/applications") && method === "GET")
        return answer(current ? [current] : []);
      if (path.endsWith("/containers/applications") && method === "POST") {
        const body = JSON.parse(String(init?.body));
        current = { ...body, id: "app-id" };
        return answer(current);
      }
      if (path.endsWith("/app-id") && method === "GET") return answer(current);
      if (path.endsWith("/app-id") && method === "PATCH") {
        current = {
          ...current,
          id: "app-id",
          name: "demo-container",
          ...JSON.parse(String(init?.body)),
        };
        return answer(current);
      }
      if (path.endsWith("/rollouts") && method === "POST")
        return answer({ id: "rollout-id", status: "progressing" });
      if (path.endsWith("/rollouts/rollout-id"))
        return answer({ id: "rollout-id", status: rolloutStatus });
      throw new Error(`Unexpected API call: ${method} ${path}`);
    },
  });
  const steps = {
    async run<T extends object>(
      _name: string,
      body: (tools: Pick<StepTools, "cf" | "log">) => Promise<T>,
    ): Promise<T> {
      return body({ cf: () => api, log: new StepLog() });
    },
  };
  return { steps, step: { sleep: async () => {} }, calls, app: () => current };
}

describe("container lifecycle", () => {
  it("creates the application's namespace-bound container with a single instance", async () => {
    const fake = world();
    await configureContainerPhase(fake.steps, fake.step, "demo", runtime);
    expect(fake.app()).toMatchObject({
      max_instances: 1,
      durable_objects: { namespace_id: "ns" },
      configuration: { image: runtime.image },
    });
  });
  it("refuses a same-named container belonging to another namespace", async () => {
    const fake = world({
      id: "other",
      name: "demo-container",
      durable_objects: { namespace_id: "someone-else" },
    });
    await expect(configureContainerPhase(fake.steps, fake.step, "demo", runtime)).rejects.toThrow(
      "belongs to another",
    );
    expect(fake.calls.every((call) => call.startsWith("GET"))).toBe(true);
  });
  it("patches then explicitly rolls out an existing application", async () => {
    const fake = world({
      id: "app-id",
      name: "demo-container",
      durable_objects: { namespace_id: "ns" },
      configuration: { image: "old" },
    });
    await configureContainerPhase(fake.steps, fake.step, "demo", runtime);
    expect(fake.calls.some((call) => call.startsWith("PATCH"))).toBe(true);
    expect(fake.calls.some((call) => call.includes("POST") && call.endsWith("/rollouts"))).toBe(
      true,
    );
  });
  it("fails a reverted rollout instead of reporting a completed update", async () => {
    const fake = world(
      { id: "app-id", name: "demo-container", durable_objects: { namespace_id: "ns" } },
      "reverted",
    );
    await expect(configureContainerPhase(fake.steps, fake.step, "demo", runtime)).rejects.toThrow(
      "reverted",
    );
  });
});
