import { describe, expect, it } from "vitest";
import { pinContainerImage } from "./container-image";

const digest = `sha256:${"a".repeat(64)}`;
const config = `sha256:${"b".repeat(64)}`;
const input = {
  image: "docker.io/library/nginx:stable",
  port: 80,
  readinessPath: "/",
  instanceType: "lite" as const,
  maxInstances: 1 as const,
  idleTimeoutSeconds: 300,
  environment: {},
  secrets: [],
  storage: "ephemeral" as const,
};

function registry(arch: string) {
  const calls: string[] = [];
  const fetcher: typeof fetch = async (request) => {
    const url = String(request);
    calls.push(url);
    if (url.includes("auth.docker.io")) return Response.json({ token: "anonymous-test-token" });
    if (url.includes("/blobs/")) return Response.json({ os: "linux", architecture: arch });
    return Response.json(
      { config: { digest: config } },
      { headers: { "docker-content-digest": digest } },
    );
  };
  return { fetcher, calls };
}

describe("container image resolution", () => {
  it("pins a public tag after checking its architecture", async () => {
    const fake = registry("amd64");
    const result = await pinContainerImage(input, fake.fetcher);
    expect(result.image).toBe(`docker.io/library/nginx@${digest}`);
    expect(result.architecture).toBe("linux/amd64");
    expect(fake.calls).toHaveLength(3);
    expect(fake.calls.every((url) => !url.includes("anonymous-test-token"))).toBe(true);
  });
  it("rejects an incompatible architecture", async () => {
    await expect(pinContainerImage(input, registry("arm64").fetcher)).rejects.toThrow(
      "Only Linux amd64",
    );
  });
  it("rejects unpinned account registry images and path traversal", async () => {
    await expect(
      pinContainerImage({ ...input, image: "registry.cloudflare.com/account/app:latest" }),
    ).rejects.toThrow("digest");
    await expect(pinContainerImage({ ...input, image: "docker.io/../app:latest" })).rejects.toThrow(
      "public Docker Hub",
    );
  });
  it("surfaces registry failures before deployment", async () => {
    const unavailable: typeof fetch = async () => new Response(null, { status: 429 });
    await expect(pinContainerImage(input, unavailable)).rejects.toThrow("HTTP 429");
  });
});
