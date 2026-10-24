import { env } from "cloudflare:workers";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireRole } from "../server/auth.server";

const KEY = "container_imports_enabled";
export const readContainerImports = createServerFn({ method: "GET" }).handler(async () => {
  await requireRole("admin");
  return {
    enabled:
      (
        await env.DB.prepare("SELECT value FROM settings WHERE key = ?1")
          .bind(KEY)
          .first<{ value: string }>()
      )?.value === "1",
  };
});
export const setContainerImports = createServerFn({ method: "POST" })
  .validator(z.object({ enabled: z.boolean() }))
  .handler(async ({ data }) => {
    await requireRole("admin");
    await env.DB.prepare(
      "INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    )
      .bind(KEY, data.enabled ? "1" : "0", Date.now())
      .run();
    return { enabled: data.enabled };
  });
