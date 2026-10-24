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
vi.mock("../server/auth.server", () => ({ requireRole }));
vi.mock("../cloudflare/client.server", () => ({ getCfClient }));
const { recoverD1 } = await import("./d1-recovery.functions");
const recover = recoverD1 as unknown as (args: {
  data: { resourceId: string; newName: string };
}) => Promise<unknown>;
const resourceId = "i1:d1:DB";
const input = { data: { resourceId, newName: "recovered-data" } };

beforeEach(async () => {
  await reset();
  await createMigrator(migrations).ensure(env.DB);
  requireRole.mockReset().mockResolvedValue(undefined);
  getCfClient.mockReset();
  await seedInstall({
    status: "uninstalled",
    resources: [{ kind: "d1", binding: "DB", name: "original", cfId: "database-id" }],
  });
  await env.DB.prepare(
    "UPDATE resources SET deleted_at = ?, confirmed_deletion_at = ? WHERE id = ?",
  )
    .bind(Date.now(), Date.now(), resourceId)
    .run();
});

function api(
  mode: "normal" | "already-restored" | "conflict" | "forbidden" | "readback-fails" = "normal",
) {
  const calls: string[] = [];
  let restored = mode === "already-restored";
  getCfClient.mockResolvedValue(
    createClient({
      accountId: "account",
      token: "test",
      fetch: async (_request, init) => {
        const method = init?.method ?? "GET";
        calls.push(method);
        if (mode === "forbidden")
          return Response.json(
            { success: false, errors: [{ code: 10000, message: "Forbidden" }] },
            { status: 403 },
          );
        if (method === "POST") {
          expect(JSON.parse(String(init?.body))).toEqual({ new_name: "recovered-data" });
          if (mode === "conflict")
            return Response.json(
              { success: false, errors: [{ code: 10000, message: "Name already exists" }] },
              { status: 409 },
            );
          restored = true;
        } else if (!restored || (mode === "readback-fails" && calls.length > 1)) {
          return Response.json(
            { success: false, errors: [{ code: 10000, message: "Not found" }] },
            { status: 404 },
          );
        }
        return Response.json({
          success: true,
          result: { uuid: "database-id", name: "recovered-data" },
          errors: [],
          messages: [],
        });
      },
    }),
  );
  return calls;
}

async function recorded() {
  return env.DB.prepare(
    "SELECT cf_id, name, deleted_at, confirmed_deletion_at, retained_at FROM resources WHERE id = ?",
  )
    .bind(resourceId)
    .first();
}

describe("D1 recovery action", () => {
  it("refuses non-admins before touching Cloudflare", async () => {
    const calls = api();
    requireRole.mockRejectedValue(new Error("permission denied"));
    await expect(recover(input)).rejects.toThrow("permission denied");
    expect(calls).toEqual([]);
  });
  it("recovers, reads back, and records the database as retained without reinstalling", async () => {
    const calls = api();
    expect(await recover(input)).toEqual({ id: "database-id", name: "recovered-data" });
    expect(calls).toEqual(["GET", "POST", "GET"]);
    expect(await recorded()).toMatchObject({
      cf_id: "database-id",
      name: "recovered-data",
      deleted_at: null,
      confirmed_deletion_at: null,
      retained_at: expect.any(Number),
    });
    expect(await env.DB.prepare("SELECT status FROM installs WHERE id = 'i1'").first()).toEqual({
      status: "uninstalled",
    });
  });
  it("reconciles a lost successful response without undeleting twice", async () => {
    const calls = api("already-restored");
    await recover(input);
    expect(calls).toEqual(["GET", "GET"]);
  });
  it.each(["conflict", "forbidden", "readback-fails"] as const)(
    "keeps the deletion record after %s",
    async (mode) => {
      api(mode);
      await expect(recover(input)).rejects.toThrow();
      expect(await recorded()).toMatchObject({
        name: "original",
        deleted_at: expect.any(Number),
        retained_at: null,
      });
    },
  );
  it("refuses unconfirmed and expired deletions before calling Cloudflare", async () => {
    const calls = api();
    await env.DB.prepare("UPDATE resources SET confirmed_deletion_at = NULL WHERE id = ?")
      .bind(resourceId)
      .run();
    await expect(recover(input)).rejects.toThrow("confirmed deletion");
    await env.DB.prepare("UPDATE resources SET confirmed_deletion_at = ? WHERE id = ?")
      .bind(Date.now() - 8 * 86400000, resourceId)
      .run();
    await expect(recover(input)).rejects.toThrow("confirmed deletion");
    expect(calls).toEqual([]);
  });
});
