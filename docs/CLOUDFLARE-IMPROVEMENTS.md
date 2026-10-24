# Cloudflare improvements and staged rollout

This implementation adds six capabilities. It has not changed the production account. Release acceptance requires operational checks in addition to the automated tests.

## Release 1: build security and diagnostics

The Sandbox SDK and base image are paired at 0.12.14. The Node base is pinned to 22.23.4. Both Docker base images use immutable digests. Wrangler is pinned to 4.152.0 and Workers types match its required generation. Build and run the sandbox image on Linux amd64 before publishing a new, immutable Appflare sandbox release. Do not reuse an upstream release tag for a locally changed image. The manager refuses repository builds on a sandbox lacking the new patched-builds capability.

Administrators get per-Worker Logs, traces and Issues controls. Changes preserve other observability settings. Hostname tracing adds an exact-host rule at 10%, preserves other rules, uses a zero-sample exact-host override when disabled, and refuses to enable a zone when that would activate tracing for unrelated rules. Inaccessible tracing APIs show instructions for the Cloudflare dashboard. The rule API replaces a list: Appflare rereads before writing, but there is no cross-client compare-and-swap guarantee. Avoid concurrent edits in the dashboard.

The manager emits server source maps without embedding source content. The packer retains maps as private `application/source-map` upload parts, separate from static assets. A published release ZIP still contains these maps; they are not confidential release contents. Issues is configured on for newly built manager and sandbox releases; sampled Worker traces remain off until enabled. Existing installed apps retain their own settings.

Logs and stored traces can incur charges. See [Cloudflare Observability pricing](https://developers.cloudflare.com/observability/pricing/). A missing trace does not prove a request never reached Cloudflare or establish the cause of a browser error.

Acceptance: read back settings, provoke one controlled staging error and inspect its mapped stack, test sign-in/catalog/settings in Chrome and Aside without resetting either browser, and restore prior diagnostic settings after the test. Preserve a known-good manager deployment for rollback. Do not change DNS, Browser Integrity Check, TLS or other security controls as part of this release.

## Release 2: reproducible repository builds and database recovery

Repository imports send dependency installation through the packer. Exact `packageManager` versions are used for installation and plain package-manager build commands. Conflicting or non-exact pins fail clearly. Frozen lockfiles and disabled install scripts remain in effect. The build records requested and actual tools in the artifact and review page. Inside the sandbox, `engines.node`, `.nvmrc` and `.node-version` must match the fixed Node runtime; this release does not install arbitrary Node versions. Existing catalog/self-deploying paths that bypass packer installation retain their own documented tool behavior.

The packer also uses explicit case-sensitive migration glob matching on macOS and Linux, matching Wrangler instead of Node's platform-dependent default.

New artifacts use format 7, including private source maps and optional toolchain metadata. Readers accept formats 1 and 7. Historic formats 2 through 6 still require repacking; future formats require a manager update. Publish the updated reader before producing new catalog artifacts for it. Old managers cannot install new format-7 artifacts, including a direct self-update to a new manager artifact. The initial upgrade needs an approved direct Worker deployment; preserve its bindings and the previous deployment for rollback.

Migration 0013 adds a confirmed D1 deletion timestamp and container snapshot state. It is additive. Only a successful D1 delete by Appflare establishes an eligible deletion time. Older, missing or already-gone records are not assigned a guessed time. Administrators can request undelete within seven days, with the original database ID and recovery name shown before confirmation. The action reads the recovered database back and records it as retained. It does not reinstall or reconnect an app. Cloudflare remains the authority on recoverability, and recovery does not replace backups. See [D1 undelete](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/undelete/).

Acceptance: import fixtures with exact npm, pnpm, Yarn and Bun versions in the actual sandbox; verify runtime refusals; use a disposable D1 database to test confirmed deletion and recovery; verify expired, denied and name-conflict paths without changing unrelated databases.

## Release 3: experimental published-image containers

Container imports default to disabled. An administrator can enable them on the Building apps settings page after the preceding releases pass. No Dockerfile builder, arbitrary registry credentials or persistent local filesystem support is included.

A repository may contain `appflare.container.json`, or an import may supply the basic image/port/readiness fields. The root descriptor takes precedence over form fields. For example:

```json
{
  "image": "docker.io/example/web:1.2.3",
  "port": 8080,
  "readinessPath": "/health",
  "instanceType": "lite",
  "maxInstances": 1,
  "idleTimeoutSeconds": 300,
  "environment": { "MODE": "production" },
  "secrets": ["API_KEY"],
  "storage": "ephemeral"
}
```

Do not put secret values in `environment` or commit them to the descriptor. `secrets` contains names; values are supplied through Appflare's secret flow. `APP_CONTAINER` is reserved, secret names must be unique, and a secret cannot also be a plain variable.

The initial pilot supports public Docker Hub images and digest-pinned images in the selected account's Cloudflare registry. Docker Hub tags resolve to a Linux amd64 digest and its configuration is checked. The isolated builder has no account token: account-registry architecture is a deployment requirement, not an independently verified builder result. A Cloudflare-registry pilot must demonstrate the image is runnable before this option is described as production-ready. Other registries are refused. See [image management](https://developers.cloudflare.com/containers/guides/image-management/).

Appflare generates its own Worker adapter and does not run repository build commands or install repository dependencies on this path. It passes only declared environment variables and secrets into the container. The application must expose HTTP on the specified port, bind to an accessible interface, and answer its readiness path successfully. Local files are temporary. External storage and databases must be configured explicitly by the application.

The generated adapter uses one named Durable Object and one container instance per app. Owned container applications are checked against the Worker's namespace; a same-named application owned by another namespace is refused. Image updates use an explicit rollout, not merely a Worker version upload. A failed rollout or live health check returns the previous image configuration and Worker deployment, then restores Appflare's recorded version/settings. Manual rollback restores saved image configuration too. Existing ownership-based pause, resume and uninstall paths apply. Conversion between Worker-only and container apps is refused; install separately instead.

Acceptance: use a disposable stateless image; prove cold start, readiness, HTTP streaming and secrets; perform image update, deliberately fail health, verify recovery, manual rollback, pause/resume, and uninstall. Confirm another namespace's container survives. Record usage and limits. Keep the feature disabled in production until this pilot passes.

## Isolated staging evidence (October 24, 2026)

The candidate was deployed as `appflare-readiness` with its own D1 database, KV namespace and Workflow. It has no cron triggers and no custom domain. Production's deployment and bindings were read back against the baseline; no production deployment, DNS, TLS, security or tracing change was made.

Chrome and Aside passed real staging sign-in and the AI category (24 of 139 live catalog apps). Diagnostic controls changed only the staging Worker. Each browser recovered a separate disposable D1 database; SQL readback proved its test marker survived. A controlled fault mapped to its TypeScript source line in Cloudflare tail output.

The container pilot found an HTTPS forwarding error in the generated adapter: the internal container connection requires HTTP. The generator now rewrites the internal URL scheme while preserving the request method, path, headers and body. A behavioral regression test was added. The schema suite (748), packer suite (357), and Sandbox suite (116) passed after the fix, as did their type checks. One packer test exceeded its five-second default in the parallel run; the isolated full packer suite passed with a 30-second test timeout.

The fixed Linux amd64 Sandbox image was rebuilt privately, published only to this account's staging registry repository by immutable digest, rolled out and probed through real Sandbox RPC. It packed a container artifact and verified the generated HTTP forwarding code in that artifact. Rollout completion was verified before the final probe; an earlier probe had correctly detected that the old image still served during rollout.

The generated adapter served in Chrome and Aside, delivered its declared test secret and streamed its response. Image update, deliberately unhealthy readiness, restoration through the real container snapshot restoration phase, and the normal Pause/Resume jobs were exercised using synthetic staging installation/snapshot records. The normal rollback UI restored the prior Worker/image and verified HTTP 200. The normal Uninstall job removed only the disposable pilot Worker/container. The temporary control Worker was removed and all staging Sandbox application instance limits were set to zero. See the staging validation report for final readbacks.

The full public-repository container import and automatic failed-update recovery gates have now passed through the deployed manager. Chrome imported cloudflare/worker-template at f72e141a694fe769ac9c1a2f77100cb6a98efa65 with a selected immutable staging image, reviewed the generated artifact and installed it. Aside rebuilt and updated it to the healthy v2 image. A deliberately unhealthy image then failed its live readiness check and the normal update workflow automatically restored the saved image, Worker version and all 17 compared installation fields. No manual restoration call or rollback job was used in this cycle. Browser readback confirmed v2 after recovery.

The test found and fixed the missing image choice in container rebuilds. Changing the image preserves the installed port, readiness path, environment and secret declarations; repository descriptors retain precedence. It also corrected the update banner and logs: container changes can interrupt service before live readiness succeeds, and a successful restore must not be reported as the failed step or described as a version that never served. Targeted workflow and DOM regression tests cover these cases.

Staging uses generated-bundle substitutions for its separate sandbox names and an explicitly scoped CLI OAuth account-read preflight; those test-harness substitutions are excluded from the feature patch. The normal API-token and stored OAuth-grant authentication paths are unchanged. The first temporary CLI credential expired during a rebuild; refreshing only the staging testing credential let that build pass.

These tests cover the stateless published-image import path for a public GitHub repository. They do not establish compatibility for every repository, private GitHub cloning, arbitrary Dockerfile builds or persistent local volumes. Custom-domain hostname tracing still requires a separate custom staging domain. The original Chrome 403 cause remains unresolved; these changes do not establish its cause. Production remains unchanged.
