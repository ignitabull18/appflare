import { type ContainerRuntime, containerRuntimeSchema } from "@appflare/schema";

async function json(response: Response): Promise<unknown> {
  if (!response.ok) throw new Error(`The image registry returned HTTP ${response.status}.`);
  if (Number(response.headers.get("content-length")) > 2 * 1024 * 1024)
    throw new Error("Image metadata is too large.");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("The image registry returned no metadata.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 2 * 1024 * 1024) throw new Error("Image metadata is too large.");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("The registry returned invalid image metadata.");
  return value as Record<string, unknown>;
}

/** Resolve public Docker Hub images without ever receiving account credentials. */
export async function pinContainerImage(
  input: Omit<ContainerRuntime, "architecture">,
  fetcher: typeof fetch = fetch,
): Promise<ContainerRuntime> {
  if (input.image.startsWith("registry.cloudflare.com/")) {
    if (!input.image.includes("@sha256:"))
      throw new Error("Cloudflare registry images must already specify their digest.");
    // The deployment checks the account-owned image; the isolated builder has no account token.
    return containerRuntimeSchema.parse({ ...input, architecture: "linux/amd64" });
  }
  const match =
    /^docker\.io\/([a-z0-9][a-z0-9_./-]*)(?::([A-Za-z0-9_.-]+)|@(sha256:[a-f0-9]{64}))$/.exec(
      input.image,
    );
  if (!match || match[1]?.split("/").some((p) => p === "." || p === ".." || p === ""))
    throw new Error(
      "Use a public Docker Hub image or a digest in this account's Cloudflare registry.",
    );
  const repo = match[1];
  const auth = object(
    await json(
      await fetcher(
        `https://auth.docker.io/token?service=registry.docker.io&scope=${encodeURIComponent(`repository:${repo}:pull`)}`,
        { signal: AbortSignal.timeout(15_000), redirect: "error" },
      ),
    ),
  );
  if (typeof auth.token !== "string")
    throw new Error("Docker Hub did not grant public image access.");
  const headers = {
    Authorization: `Bearer ${auth.token}`,
    Accept:
      "application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json",
  };
  const load = async (ref: string) => {
    const response = await fetcher(`https://registry-1.docker.io/v2/${repo}/manifests/${ref}`, {
      headers,
      signal: AbortSignal.timeout(15_000),
      redirect: "error",
    });
    const digest = response.headers.get("docker-content-digest");
    if (!digest || !/^sha256:[a-f0-9]{64}$/.test(digest))
      throw new Error("The registry returned no immutable image digest.");
    if (ref.startsWith("sha256:") && digest !== ref)
      throw new Error("The registry returned a different image digest than requested.");
    return { digest, manifest: object(await json(response)) };
  };
  let image = await load(match[3] ?? match[2] ?? "latest");
  if (Array.isArray(image.manifest.manifests)) {
    const amd = image.manifest.manifests.map(object).find((m) => {
      const p = object(m.platform);
      return p.os === "linux" && p.architecture === "amd64";
    });
    if (!amd || typeof amd.digest !== "string" || !/^sha256:[a-f0-9]{64}$/.test(amd.digest))
      throw new Error("This image has no Linux amd64 build.");
    image = await load(amd.digest);
  }
  const config = object(image.manifest.config);
  if (typeof config.digest !== "string" || !/^sha256:[a-f0-9]{64}$/.test(config.digest))
    throw new Error("The image has no configuration digest.");
  const configResponse = object(
    await json(
      await fetcher(`https://registry-1.docker.io/v2/${repo}/blobs/${config.digest}`, {
        headers,
        signal: AbortSignal.timeout(15_000),
      }),
    ),
  );
  if (configResponse.os !== "linux" || configResponse.architecture !== "amd64")
    throw new Error("Only Linux amd64 images can be installed.");
  return containerRuntimeSchema.parse({
    ...input,
    image: `docker.io/${repo}@${image.digest}`,
    architecture: "linux/amd64",
  });
}
