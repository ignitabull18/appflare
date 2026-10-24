import type { ContainerApplicationConfiguration } from "@appflare/cf-api";
import type { ContainerRuntime } from "@appflare/schema";
import { eq } from "drizzle-orm";
import { createDb } from "../db/client";
import { snapshots } from "../db/schema";
import type { StepRunner } from "./run-job";
import { JobError, type StepTools } from "./steps";

type ContainerSteps = {
  run<T extends object>(
    name: string,
    body: (tools: Pick<StepTools, "cf" | "log">) => Promise<T>,
  ): Promise<T>;
};

/** Roll out only an application's own namespace; never adopt a same-named app. */
export async function configureContainerPhase(
  steps: ContainerSteps,
  step: Pick<StepRunner, "sleep">,
  workerName: string,
  runtime: ContainerRuntime,
  label = "deploy container",
  configuration?: ContainerApplicationConfiguration,
) {
  const target = configuration ?? { image: runtime.image, instance_type: runtime.instanceType };
  const plan = await steps.run(`${label} plan`, async ({ cf }) => {
    const api = cf();
    const namespace = (await api.workers.listDurableObjectNamespaces()).find(
      (n) => n.script === workerName && n.class === "AppContainer",
    );
    if (!namespace)
      throw new JobError("The application's container namespace is not available yet.");
    const apps = await api.containers.listApplications({ name: `${workerName}-container` });
    const app = apps.find((a) => a.name === `${workerName}-container`);
    if (app && app.durable_objects?.namespace_id !== namespace.id)
      throw new JobError(
        "A container with this name belongs to another application. Choose another Worker name.",
      );
    return { id: app?.id ?? null, namespaceId: namespace.id };
  });
  let deployed: { id: string; rolloutId: string | null };
  if (plan.id === null) {
    deployed = await steps.run(`${label} create`, async ({ cf, log }) => {
      const api = cf();
      const apps = await api.containers.listApplications({ name: `${workerName}-container` });
      const found = apps.find((a) => a.name === `${workerName}-container`);
      if (found && found.durable_objects?.namespace_id !== plan.namespaceId)
        throw new JobError("The container name is owned by another application.");
      const created =
        found ??
        (await api.containers.createApplication({
          name: `${workerName}-container`,
          scheduling_policy: "default",
          instances: 0,
          max_instances: 1,
          configuration: target,
          durable_objects: { namespace_id: plan.namespaceId },
          constraints: { tiers: [1, 2] },
          observability: { logs: { enabled: true } },
        }));
      log.info(`Created container application ${created.name}; its image is pinned by digest.`);
      return { id: created.id, rolloutId: null };
    });
  } else {
    const id = plan.id;
    await steps.run(`${label} configure`, async ({ cf }) => {
      await cf().containers.modifyApplication(id, { configuration: target, max_instances: 1 });
      return {};
    });
    deployed = await steps.run(`${label} rollout`, async ({ cf }) => {
      const api = cf();
      const app = await api.containers.getApplication(id);
      if (app.active_rollout_id) {
        const active = await api.containers.getRollout(id, app.active_rollout_id);
        if (
          active.target_configuration?.image === target.image &&
          active.target_configuration?.instance_type === target.instance_type
        )
          return { id, rolloutId: active.id };
      }
      const rollout = await api.containers.createRollout(id, {
        description: `Appflare: ${label}`,
        strategy: "rolling",
        kind: "full_auto",
        target_configuration: target,
        step_percentage: 100,
      });
      return { id, rolloutId: rollout.id };
    });
  }
  if (deployed.rolloutId) {
    for (let attempt = 0; attempt < 30; attempt++) {
      const result = await steps.run(`${label} progress ${attempt}`, async ({ cf }) => {
        const rollout = await cf().containers.getRollout(deployed.id, deployed.rolloutId as string);
        return { status: rollout.status ?? "unknown" };
      });
      if (result.status === "completed") {
        await steps.run(`${label} verify`, async ({ cf }) => {
          const app = await cf().containers.getApplication(deployed.id);
          if (
            app.configuration?.image !== target.image ||
            app.durable_objects?.namespace_id !== plan.namespaceId
          )
            throw new JobError(
              "Cloudflare did not confirm the expected container configuration and ownership.",
            );
          return {};
        });
        return deployed;
      }
      if (["failed", "reverted", "replaced"].includes(result.status))
        throw new JobError(`Container rollout ${result.status}.`);
      await step.sleep(`${label} wait ${attempt}`, "10 seconds");
    }
    throw new JobError("Container rollout did not finish within five minutes.");
  }
  return deployed;
}

export async function restoreContainerSnapshotPhase(
  steps: ContainerSteps,
  step: Pick<StepRunner, "sleep">,
  db: D1Database,
  snapshotId: string,
  workerName: string,
) {
  const [snapshot] = await createDb(db)
    .select()
    .from(snapshots)
    .where(eq(snapshots.id, snapshotId))
    .limit(1);
  if (!snapshot?.container_state_json || !snapshot.manifest_json)
    throw new JobError("This snapshot has no verified container recovery state.");
  const manifest = JSON.parse(snapshot.manifest_json) as {
    catalog?: { runtime?: ContainerRuntime };
  };
  if (!manifest.catalog?.runtime)
    throw new JobError("This snapshot has no container runtime declaration.");
  const saved = JSON.parse(snapshot.container_state_json) as ContainerApplicationConfiguration;
  await configureContainerPhase(
    steps,
    step,
    workerName,
    manifest.catalog.runtime,
    "restore container",
    saved,
  );
}
