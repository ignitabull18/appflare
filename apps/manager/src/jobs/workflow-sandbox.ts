import { type SandboxBuildsBinding, sandboxBinding } from "../sandbox/binding";

/** RPC calls run against the serving manager, whose sandbox binding may be newer
 * than the bindings captured by an already-running Workflow. */
export type WorkflowSandboxRpc = {
  [K in keyof SandboxBuildsBinding as `sandbox${Capitalize<K>}`]: SandboxBuildsBinding[K];
};

/** Only jobs waiting for automatic setup need this indirection. Keep ordinary
 * jobs and managers without the new RPC surface on their existing bindings. */
export function withWorkflowSandbox<E extends { SANDBOX?: unknown; SELF?: unknown }>(
  env: E,
  params: Readonly<Record<string, unknown>>,
): E & { SANDBOX?: unknown } {
  if (typeof params.sandboxEnableJob !== "string") return env;
  const candidate = env.SELF as Partial<WorkflowSandboxRpc> | undefined;
  if (typeof candidate?.sandboxInfo !== "function") return env;
  const rpc = candidate as WorkflowSandboxRpc;
  const binding: SandboxBuildsBinding = {
    info: () => rpc.sandboxInfo(),
    fetch: (input, init) => rpc.sandboxFetch(input, init),
    build: (request) => rpc.sandboxBuild(request),
    buildRepository: (request) => rpc.sandboxBuildRepository(request),
    progress: (request) => rpc.sandboxProgress(request),
    cleanup: (request) => rpc.sandboxCleanup(request),
    deploySelfManaged: (request) => rpc.sandboxDeploySelfManaged(request),
    destroySelfManaged: (request) => rpc.sandboxDestroySelfManaged(request),
    selfManagedStatus: (request) => rpc.sandboxSelfManagedStatus(request),
    githubFetch: (request) => rpc.sandboxGithubFetch(request),
  };
  return { ...env, SANDBOX: binding };
}

/** Used only inside a fresh JobUnits invocation. Never resolve through SELF
 * here, which would recurse when automatic setup has not connected it yet. */
export function currentSandbox(env: { SANDBOX?: unknown }): SandboxBuildsBinding {
  const binding = sandboxBinding(env);
  if (!binding) throw new Error("Appflare is not connected to a sandbox Worker yet");
  return binding;
}
