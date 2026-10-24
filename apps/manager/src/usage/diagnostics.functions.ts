import { env } from "cloudflare:workers";
import { CloudflareApiError } from "@appflare/cf-api";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { getCfClient } from "../cloudflare/client.server";
import { createDb } from "../db/client";
import { installs, jobs, resources } from "../db/schema";
import { readSettings, SETTING } from "../db/settings";
import { requireRole } from "../server/auth.server";
import {
  diagnosticSettings,
  diagnosticsChange,
  diagnosticsInput,
  TRACE_SETUP_HELP,
} from "./diagnostics";

async function target(installId?: string) {
  const db = createDb(env.DB);
  if (installId === undefined) {
    const settings = await readSettings(db, [SETTING.workerName]);
    if (!settings.worker_name) throw new Error("Finish connecting Appflare first.");
    return { workers: [settings.worker_name], hostname: new URL(getRequest().url).hostname };
  }
  const [install] = await db.select().from(installs).where(eq(installs.id, installId)).limit(1);
  if (install?.status !== "installed")
    throw new Error("Diagnostics can be changed once the app is installed.");
  const rows = await db
    .select({ name: resources.name })
    .from(resources)
    .where(
      and(
        eq(resources.install_id, installId),
        eq(resources.kind, "worker"),
        isNull(resources.deleted_at),
      ),
    );
  return {
    workers: [...new Set([install.worker_name, ...rows.map((r) => r.name)])],
    hostname: install.served_domain,
  };
}

async function idle(installId?: string) {
  const running = await createDb(env.DB)
    .select({ id: jobs.id })
    .from(jobs)
    .where(
      and(
        inArray(jobs.status, ["queued", "running"]),
        installId ? eq(jobs.install_id, installId) : isNull(jobs.install_id),
      ),
    )
    .limit(1);
  if (running.length)
    throw new Error("Wait for the running deployment or maintenance job to finish.");
}

async function state(installId?: string) {
  const api = await getCfClient(env);
  const own = await target(installId);
  const workers = await Promise.all(
    own.workers.map(async (name) => {
      const settings = await api.workers.getScriptSettings(name);
      const block = settings.observability;
      return {
        name,
        logs: block?.enabled === true && block.logs?.enabled !== false,
        traces: block?.enabled === true && block.traces?.enabled === true,
        issues: block?.issues?.enabled === true,
        sampling: block?.traces?.head_sampling_rate ?? 0.1,
        dashboard: `https://dash.cloudflare.com/${api.accountId}/workers/services/view/${encodeURIComponent(name)}/production/observability`,
      };
    }),
  );
  let hostnameTrace: { enabled: boolean; sampling: number; zoneId: string } | null = null;
  let hostnameProblem: string | null = null;
  if (own.hostname) {
    try {
      const zones = await api.zones.listZones({ accountId: api.accountId, status: "active" });
      const zone = zones
        .filter((z) => own.hostname === z.name || own.hostname?.endsWith(`.${z.name}`))
        .sort((a, b) => b.name.length - a.name.length)[0];
      if (!zone) throw new Error("This address has no accessible Cloudflare zone.");
      const [settings, { rules }] = await Promise.all([
        api.tracing.settings(zone.id),
        api.tracing.rules(zone.id),
      ]);
      const rule = rules.find((r) => r.description === `Appflare diagnostics: ${own.hostname}`);
      hostnameTrace = {
        zoneId: zone.id,
        enabled:
          settings.enabled &&
          settings.persist &&
          rule?.enabled === true &&
          rule.action_parameters.sampling_ratio > 0,
        sampling: rule?.action_parameters.sampling_ratio ?? 0.1,
      };
    } catch {
      hostnameProblem = TRACE_SETUP_HELP;
    }
  } else
    hostnameProblem =
      "Attach a custom domain to configure hostname tracing. Worker traces remain available.";
  return { workers, hostname: own.hostname, hostnameTrace, hostnameProblem };
}

export const getDiagnostics = createServerFn({ method: "GET" })
  .validator(diagnosticsInput)
  .handler(async ({ data }) => {
    await requireRole("admin");
    return state(data.installId);
  });

export const changeDiagnostics = createServerFn({ method: "POST" })
  .validator(diagnosticsChange)
  .handler(async ({ data }) => {
    await requireRole("admin");
    await idle(data.installId);
    const api = await getCfClient(env);
    const own = await target(data.installId);
    const changed: string[] = [];
    if (data.workerName && !own.workers.includes(data.workerName))
      throw new Error("This Worker does not belong to the selected app.");
    for (const name of own.workers.filter((name) => !data.workerName || name === data.workerName)) {
      try {
        const current = await api.workers.getScriptSettings(name);
        await api.workers.setObservabilitySettings(
          name,
          diagnosticSettings(current.observability, data.feature, data.enabled, data.sampling),
        );
        changed.push(name);
      } catch (error) {
        const permission = error instanceof CloudflareApiError && error.status === 403;
        throw new Error(
          `Could not change diagnostics for ${name}.${permission ? " Grant Workers Scripts: Edit and Workers Observability access in Cloudflare." : " Try again."}${changed.length ? ` Already changed: ${changed.join(", ")}.` : ""}`,
        );
      }
    }
    return state(data.installId);
  });

export const changeHostnameTracing = createServerFn({ method: "POST" })
  .validator(diagnosticsInput.extend({ enabled: z.boolean() }))
  .handler(async ({ data }) => {
    await requireRole("admin");
    await idle(data.installId);
    const before = await state(data.installId);
    if (!before.hostname || !before.hostnameTrace)
      throw new Error(before.hostnameProblem ?? TRACE_SETUP_HELP);
    const api = await getCfClient(env);
    const id = before.hostnameTrace.zoneId;
    const [settings, original] = await Promise.all([
      api.tracing.settings(id),
      api.tracing.rules(id),
    ]);
    const description = `Appflare diagnostics: ${before.hostname}`;
    const owned = {
      action: "set_trace_settings" as const,
      action_parameters: { sampling_ratio: data.enabled ? 0.1 : 0 },
      description,
      enabled: true,
      expression: `(http.host eq ${JSON.stringify(before.hostname)})`,
    };
    const rules = original.rules.filter((r) => r.description !== description);
    if (
      data.enabled &&
      ((!settings.enabled &&
        rules.some((r) => r.enabled && r.action_parameters.sampling_ratio > 0)) ||
        (settings.enabled && !settings.persist))
    ) {
      throw new Error(
        "Enabling this rule would also activate or persist tracing for other existing rules. Review this domain's tracing settings in Cloudflare first; Appflare has changed nothing.",
      );
    }
    // Prepend the exact-host override so a broader earlier rule cannot hide it.
    const latest = await api.tracing.rules(id);
    if (JSON.stringify(latest) !== JSON.stringify(original))
      throw new Error("Trace rules changed in Cloudflare. Reload before trying again.");
    await api.tracing.setRules(id, [owned, ...rules]);
    if (data.enabled) {
      // An inactive zone must start with zero baseline sampling to avoid tracing other hosts.
      await api.tracing.setSettings(id, {
        enabled: true,
        persist: true,
        ...(settings.enabled ? {} : { sampling_ratio: 0 }),
      });
    }
    return state(data.installId);
  });
