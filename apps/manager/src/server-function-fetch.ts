/** A rejected transport response, before TanStack tries to deserialize it. */
export class ServerFunctionResponseError extends Error {
  readonly status: number;
  readonly requestReference: string | null;

  constructor(response: Response) {
    const ray = response.headers.get("cf-ray");
    const reference = ray && /^[a-f0-9]{16}(?:-[A-Z]{3})?$/i.test(ray) ? ray : null;
    const detail = response.ok
      ? "The server returned an unexpected response."
      : `The server returned HTTP ${response.status}.`;
    super(
      `Appflare could not load this page. ${detail} Try reloading. If it happens again, share this message.${reference ? ` Request reference: ${reference}.` : ""}`,
    );
    this.name = "ServerFunctionResponseError";
    this.status = response.status;
    this.requestReference = reference;
  }
}

/**
 * Use only as Start's serverFns.fetch hook, never as a global fetch override.
 * Preserve requests, valid protocol responses and raw-response functions.
 * Do not replay requests, consume error bodies, or interpret a refusal as data.
 */
export function createServerFunctionFetch(transport: typeof fetch): typeof fetch {
  return async (input, init) => {
    const response = await transport(input, init);
    if (response.headers.get("x-tss-raw") === "true") return response;
    const type = response.headers.get("content-type")?.toLowerCase();
    if (!type || type.split(";", 1)[0]?.trim() === "text/html") {
      throw new ServerFunctionResponseError(response);
    }
    return response;
  };
}

export const serverFunctionFetch = createServerFunctionFetch((input, init) => fetch(input, init));
