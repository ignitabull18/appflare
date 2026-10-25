import { env } from "cloudflare:workers";
import { createServerFn } from "@tanstack/react-start";
import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { z } from "zod";
import { getCfClient } from "../cloudflare/client.server";
import { createDb } from "../db/client";
import { installs, jobs, resources } from "../db/schema";
import { releaseSettingsLock, tryAcquireSettingsLock } from "../db/settings-lock";
import { requireRole } from "../server/auth.server";
import {
  D1_RECOVERY_WINDOW_MS,
  recoveryDeadline,
  recoveryEligible,
  recoveryName,
} from "./d1-recovery";

export const listD1Recovery = createServerFn({ method: "GET" }).handler(async () => {
  await requireRole("admin");
  const rows = await createDb(env.DB)
    .select({
      id: resources.id,
      installId: resources.install_id,
      name: resources.name,
      cfId: resources.cf_id,
      deletedAt: resources.deleted_at,
      confirmedAt: resources.confirmed_deletion_at,
    })
    .from(resources)
    .innerJoin(installs, eq(installs.id, resources.install_id))
    .where(
      and(eq(resources.kind, "d1"), isNotNull(resources.deleted_at), isNull(installs.forgotten_at)),
    );
  const now = Date.now();
  return rows
    .filter((r) => r.deletedAt !== null && r.deletedAt.getTime() > now - D1_RECOVERY_WINDOW_MS)
    .map((r) => ({
      ...r,
      deletedAt: r.deletedAt?.toISOString() ?? null,
      confirmedAt: r.confirmedAt?.toISOString() ?? null,
      deadline: recoveryDeadline(r.confirmedAt),
      eligible: recoveryEligible(r.confirmedAt, now),
      destination: recoveryName(r.name, r.cfId ?? r.id),
    }));
});

export const recoverD1 = createServerFn({ method: "POST" })
  .validator(
    z.object({ resourceId: z.string().min(1), newName: z.string().regex(/^[a-zA-Z0-9_-]{1,63}$/) }),
  )
  .handler(async ({ data }) => {
    await requireRole("admin");
    const key = `d1_recovery:${data.resourceId}`;
    const owner = crypto.randomUUID();
    if (!(await tryAcquireSettingsLock(env.DB, key, owner, 60_000, Date.now())))
      throw new Error("This database is already being recovered. Reload shortly.");
    try {
      const db = createDb(env.DB);
      const [row] = await db
        .select()
        .from(resources)
        .where(and(eq(resources.id, data.resourceId), eq(resources.kind, "d1")))
        .limit(1);
      if (
        !row?.cf_id ||
        !row.deleted_at ||
        !recoveryEligible(row.confirmed_deletion_at, Date.now())
      )
        throw new Error(
          "The database has no confirmed deletion within the seven-day recovery window.",
        );
      const running = await db
        .select({ id: jobs.id })
        .from(jobs)
        .where(
          and(eq(jobs.install_id, row.install_id), inArray(jobs.status, ["queued", "running"])),
        )
        .limit(1);
      if (running.length) throw new Error("Wait for the app's running job to finish.");
      const api = await getCfClient(env);
      // Reconcile an earlier attempt that completed remotely before its response was lost.
      let recovered: Awaited<ReturnType<typeof api.d1.getDatabase>> | undefined;
      try {
        recovered = await api.d1.getDatabase(row.cf_id);
      } catch (error) {
        if (!(error instanceof Error && "status" in error && error.status === 404)) throw error;
      }
      if (!recovered) recovered = await api.d1.undeleteDatabase(row.cf_id, data.newName);
      const verified = await api.d1.getDatabase(recovered.uuid);
      if (verified.uuid !== row.cf_id || recovered.uuid !== row.cf_id)
        throw new Error("Cloudflare did not confirm the recovered database.");
      await db
        .update(resources)
        .set({
          cf_id: verified.uuid,
          name: verified.name,
          deleted_at: null,
          confirmed_deletion_at: null,
          retained_at: new Date(),
        })
        .where(and(eq(resources.id, row.id), isNotNull(resources.deleted_at)));
      return { name: verified.name, id: verified.uuid };
    } finally {
      await releaseSettingsLock(env.DB, key, owner);
    }
  });
