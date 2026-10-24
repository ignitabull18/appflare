import { z } from "zod";

const name = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/)
  .refine((value) => value !== "APP_CONTAINER", "APP_CONTAINER is reserved by the runtime");
const containerFields = z.strictObject({
  image: z
    .string()
    .max(512)
    .regex(
      /^(?:docker\.io\/[a-z0-9][a-z0-9_./-]*|registry\.cloudflare\.com\/[a-zA-Z0-9_./-]+)(?::[a-zA-Z0-9_.-]+|@sha256:[a-f0-9]{64})$/,
    ),
  port: z.int().min(1).max(65535),
  readinessPath: z
    .string()
    .max(1024)
    .regex(/^\/(?!\/)[^\s?#]*$/)
    .default("/"),
  instanceType: z.enum(["lite", "standard-1", "standard-2"]).default("lite"),
  maxInstances: z.literal(1).default(1),
  idleTimeoutSeconds: z.int().min(60).max(3600).default(300),
  environment: z
    .record(name, z.string().max(4096))
    .refine(
      (value) => Object.keys(value).length <= 100,
      "At most 100 environment variables are supported",
    )
    .default({}),
  secrets: z.array(name).max(100).default([]),
  storage: z.literal("ephemeral").default("ephemeral"),
});

const separateSecrets = (value: { environment: Record<string, string>; secrets: string[] }) =>
  new Set(value.secrets).size === value.secrets.length &&
  value.secrets.every((key) => !(key in value.environment));
export const containerImportSchema = containerFields.refine(
  separateSecrets,
  "Secrets must be unique and must not also be plain environment variables",
);
export const containerRuntimeSchema = containerFields
  .extend({
    image: z
      .string()
      .max(512)
      .regex(/^(?:docker\.io|registry\.cloudflare\.com)\/[a-zA-Z0-9_./-]+@sha256:[a-f0-9]{64}$/),
    architecture: z.literal("linux/amd64"),
  })
  .refine(
    separateSecrets,
    "Secrets must be unique and must not also be plain environment variables",
  );
export type ContainerRuntime = z.infer<typeof containerRuntimeSchema>;

/** A maintained adapter; imported repositories cannot supply arbitrary Worker code. */
export function containerWorkerSource(input: ContainerRuntime): string {
  const spec = containerRuntimeSchema.parse(input);
  const names = [...new Set([...Object.keys(spec.environment), ...spec.secrets])];
  return `import { DurableObject } from "cloudflare:workers";
const port = ${spec.port};
const readiness = ${JSON.stringify(spec.readinessPath)};
const names = ${JSON.stringify(names)};
export class AppContainer extends DurableObject {
  async fetch(request) {
    const container = this.ctx.container;
    if (!container) return new Response("Container runtime is unavailable", { status: 503 });
    if (!container.running) {
      const env = Object.fromEntries(names.filter(n => typeof this.env[n] === "string").map(n => [n, this.env[n]]));
      container.start({ enableInternet: true, env });
    }
    await container.setInactivityTimeout(${spec.idleTimeoutSeconds * 1000});
    const service = container.getTcpPort(port);
    let ready = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      try {
        const response = await service.fetch(new Request("http://container" + readiness, { signal: AbortSignal.timeout(1000) }));
        const ok = response.ok;
        await response.body?.cancel();
        if (ok) { ready = true; break; }
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    if (!ready) return new Response("The application is not ready. Check its container logs.", { status: 503 });
    const target = new URL(request.url);
    target.protocol = "http:";
    return service.fetch(new Request(target, request));
  }
}
export default { fetch(request, env) { return env.APP_CONTAINER.getByName("app").fetch(request); } };
`;
}

export function containerWorkerConfig(input: ContainerRuntime) {
  return {
    name: "imported-container",
    main: "worker.js",
    compatibility_date: "2026-09-21",
    vars: input.environment,
    durable_objects: { bindings: [{ name: "APP_CONTAINER", class_name: "AppContainer" }] },
    migrations: [{ tag: "container-v1", new_sqlite_classes: ["AppContainer"] }],
    observability: { enabled: true, issues: { enabled: true } },
  };
}
