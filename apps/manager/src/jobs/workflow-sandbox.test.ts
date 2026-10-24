import { describe, expect, it, vi } from "vitest";
import { sandboxBinding } from "../sandbox/binding";
import { currentSandbox, withWorkflowSandbox } from "./workflow-sandbox";

describe("a Workflow created before automatic sandbox setup", () => {
  it("uses the serving manager after connection without replacing the captured env", async () => {
    let connected = false;
    const request = { repo: "cloudflare/worker-template", attempt: 1 };
    const buildRepository = vi.fn(async (input: { repo: string }) => ({ built: input.repo }));
    const rpc = {
      sandboxInfo: vi.fn(async () => {
        if (!connected) throw new Error("not connected yet");
        return { sandboxVersion: "0.2.0-ignitabull.1" };
      }),
      sandboxBuildRepository: buildRepository,
      sandboxFetch: vi.fn(async () => new Response("verified artifact")),
    };
    const captured = { SELF: rpc };
    const binding = sandboxBinding(withWorkflowSandbox(captured, { sandboxEnableJob: "enable-1" }));
    expect(binding).toBeDefined();
    await expect(binding?.info()).rejects.toThrow("not connected yet");
    connected = true;
    await expect(binding?.info()).resolves.toEqual({ sandboxVersion: "0.2.0-ignitabull.1" });
    await expect(binding?.buildRepository(request)).resolves.toEqual({ built: request.repo });
    expect(buildRepository).toHaveBeenCalledWith(request);
    const response = await binding?.fetch("https://sandbox/builds/test/manifest.json", {
      headers: { Range: "bytes=0-19" },
    });
    expect(await response?.text()).toBe("verified artifact");
    expect(rpc.sandboxFetch).toHaveBeenCalledWith("https://sandbox/builds/test/manifest.json", {
      headers: { Range: "bytes=0-19" },
    });
    expect(captured).not.toHaveProperty("SANDBOX");
  });

  it("prefers the serving binding when the captured binding points to a deleted Worker", async () => {
    const stale = {
      info: vi.fn(async () => {
        throw new Error("deleted");
      }),
    };
    const fresh = vi.fn(async () => ({ current: true }));
    const env = withWorkflowSandbox(
      { SANDBOX: stale, SELF: { sandboxInfo: fresh } },
      {
        sandboxEnableJob: "enable-2",
      },
    );
    await expect(sandboxBinding(env)?.info()).resolves.toEqual({ current: true });
    expect(stale.info).not.toHaveBeenCalled();
  });

  it("keeps ordinary jobs and older SELF implementations on their existing path", () => {
    const env = { SANDBOX: { info: vi.fn() }, SELF: { sandboxInfo: vi.fn() } };
    expect(withWorkflowSandbox(env, {})).toBe(env);
    const older = { SANDBOX: env.SANDBOX, SELF: {} };
    expect(withWorkflowSandbox(older, { sandboxEnableJob: "enable-3" })).toBe(older);
  });

  it("never resolves SELF recursively inside the RPC callee", () => {
    const self = { sandboxInfo: vi.fn() };
    const missing = { SANDBOX: undefined, SELF: self };
    expect(() => currentSandbox(missing)).toThrow("not connected");
    expect(self.sandboxInfo).not.toHaveBeenCalled();
  });
});
