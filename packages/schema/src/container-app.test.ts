import { describe, expect, it } from "vitest";
import {
  containerImportSchema,
  containerRuntimeSchema,
  containerWorkerSource,
} from "./container-app";

describe("stateless container declarations", () => {
  const valid = {
    image: `docker.io/library/nginx@sha256:${"a".repeat(64)}`,
    port: 80,
    architecture: "linux/amd64",
  };
  it("pins the runtime to a digest and caps the pilot at one instance", () => {
    const runtime = containerRuntimeSchema.parse(valid);
    expect(runtime.maxInstances).toBe(1);
    expect(runtime.idleTimeoutSeconds).toBe(300);
    expect(
      containerRuntimeSchema.safeParse({ ...valid, image: "docker.io/library/nginx:latest" })
        .success,
    ).toBe(false);
    expect(containerRuntimeSchema.safeParse({ ...valid, maxInstances: 5 }).success).toBe(false);
  });
  it("rejects private or unsupported registries and persistent filesystem claims", () => {
    expect(
      containerImportSchema.safeParse({ image: "ghcr.io/acme/app:latest", port: 80 }).success,
    ).toBe(false);
    expect(
      containerImportSchema.safeParse({
        image: "docker.io/library/nginx:latest",
        port: 80,
        storage: "persistent",
      }).success,
    ).toBe(false);
    expect(
      containerImportSchema.safeParse({ image: "docker.io/library/nginx:latest", port: 0 }).success,
    ).toBe(false);
    expect(
      containerImportSchema.safeParse({
        image: "docker.io/library/nginx:latest",
        port: 80,
        readinessPath: "//another-host",
      }).success,
    ).toBe(false);
  });
  it("refuses reserved bindings, duplicate secrets and plaintext secret overlap", () => {
    for (const fields of [
      { environment: { APP_CONTAINER: "bad" } },
      { secrets: ["APP_CONTAINER"] },
      { secrets: ["TOKEN", "TOKEN"] },
      { environment: { TOKEN: "plaintext" }, secrets: ["TOKEN"] },
    ]) {
      expect(
        containerImportSchema.safeParse({
          image: "docker.io/library/nginx:latest",
          port: 80,
          ...fields,
        }).success,
      ).toBe(false);
    }
  });
  it("passes only declared environment names to the container", () => {
    const source = containerWorkerSource(
      containerRuntimeSchema.parse({
        ...valid,
        environment: { MODE: "production" },
        secrets: ["APP_KEY"],
      }),
    );
    expect(source).toContain('["MODE","APP_KEY"]');
    expect(source).not.toContain("Object.entries(this.env)");
    expect(source).toContain("AbortSignal.timeout(1000)");
    expect(source).toContain("return service.fetch(new Request(target, request))");
  });
  it("forwards HTTPS requests over internal HTTP while preserving method, path, headers and body", async () => {
    const source = containerWorkerSource(containerRuntimeSchema.parse(valid))
      .replace(/^import .*;\n/, "")
      .replace("export class AppContainer", "class AppContainer")
      .replace(/export default .*;\n?$/, "");
    class StubDurableObject {
      constructor(
        public ctx: unknown,
        public env: unknown,
      ) {}
    }
    const Adapter = new Function("DurableObject", `${source}; return AppContainer;`)(
      StubDurableObject,
    ) as new (
      ctx: unknown,
      env: unknown,
    ) => { fetch(request: Request): Promise<Response> };
    const forwarded: Request[] = [];
    const app = new Adapter(
      {
        container: {
          running: true,
          setInactivityTimeout: async () => {},
          getTcpPort: () => ({
            fetch: async (request: Request) => {
              if (new URL(request.url).hostname === "container") return new Response("ready");
              forwarded.push(request);
              return new Response(await request.text());
            },
          }),
        },
      },
      {},
    );
    const response = await app.fetch(
      new Request("https://app.example/api/write?q=1", {
        method: "POST",
        headers: { "x-fixture": "preserved" },
        body: "fixture payload",
      }),
    );
    expect(await response.text()).toBe("fixture payload");
    expect(forwarded[0]?.url).toBe("http://app.example/api/write?q=1");
    expect(forwarded[0]?.method).toBe("POST");
    expect(forwarded[0]?.headers.get("x-fixture")).toBe("preserved");
  });
});
