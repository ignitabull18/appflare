import { describe, expect, it } from "vitest";
import { createServerFunctionFetch, ServerFunctionResponseError } from "./server-function-fetch";

describe("server function transport errors", () => {
  it("preserves a headerless refusal's status and reference without exposing its body or retrying", async () => {
    let calls = 0;
    const response = new Response(null, {
      status: 403,
      headers: { "cf-ray": "a4f5c7a51a0e6052-YVR" },
    });
    const transport = createServerFunctionFetch(async () => {
      calls++;
      return response;
    });
    const error = await transport("https://appflare.example/_serverFn/read").catch((e) => e);
    expect(error).toBeInstanceOf(ServerFunctionResponseError);
    expect(error.status).toBe(403);
    expect(error.message).toContain("HTTP 403");
    expect(error.requestReference).toBe("a4f5c7a51a0e6052-YVR");
    expect(error.message).not.toContain("Invariant failed");
    expect(calls).toBe(1);
  });

  it("passes JSON Access refusals, serialized and raw protocol responses through untouched", async () => {
    for (const response of [
      Response.json({ code: "access_denied" }, { status: 403 }),
      new Response("{}", { status: 403, headers: { "content-type": "application/problem+json" } }),
      new Response("{}", {
        headers: { "content-type": "application/json", "x-tss-serialized": "true" },
      }),
      new Response(null, { headers: { "x-tss-raw": "true" } }),
    ]) {
      expect(
        await createServerFunctionFetch(async () => response)(
          "https://appflare.example/_serverFn/read",
        ),
      ).toBe(response);
      expect(response.bodyUsed).toBe(false);
    }
  });

  it("rejects an HTML sign-in/error page without exposing HTML or claiming it succeeded", async () => {
    const response = new Response("<html>private upstream content</html>", {
      headers: { "content-type": "Text/HTML; charset=utf-8", "cf-ray": "untrusted-reference" },
    });
    const error = await createServerFunctionFetch(async () => response)(
      "https://appflare.example/_serverFn/read",
    ).catch((e) => e);
    expect(error.message).toContain("unexpected response");
    expect(error.message).not.toContain("private");
    expect(error.requestReference).toBeNull();
    expect(response.bodyUsed).toBe(false);
  });

  it("forwards mutation bodies, credentials and cancellation unchanged, without retrying", async () => {
    const failure = new DOMException("Cancelled", "AbortError");
    const init: RequestInit = {
      method: "POST",
      body: "mutation",
      credentials: "same-origin",
      signal: new AbortController().signal,
    };
    let calls = 0;
    const transport = createServerFunctionFetch(async (input, actual) => {
      calls++;
      expect(input).toBe("https://appflare.example/_serverFn/write");
      expect(actual).toBe(init);
      throw failure;
    });
    await expect(transport("https://appflare.example/_serverFn/write", init)).rejects.toBe(failure);
    expect(calls).toBe(1);
  });
});
