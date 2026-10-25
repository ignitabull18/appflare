# Ignitabull release candidate

This fork is maintained at `ignitabull18/appflare`, branch
`fix/cloudflare-readiness-and-recovery`. Production deployment requires Jeremy's
approval after the candidate and its checks have been reviewed. Publication and staging checks were authorized separately by Jeremy.
Production deployment and automatic updates still need his approval.

## Candidate artifacts

Manager version: `0.6.0-ignitabull.2`; sandbox version:
`0.2.0-ignitabull.1`. Build from a clean committed checkout with pnpm 10.34.5.
Use `--repository ignitabull18/appflare` with `scripts/release-pack.ts` for both
artifacts. The artifact source SHA must equal the tested fork commit. Unsigned packs are review artifacts. Sign final candidates with the independent
`appflare-ignitabull-2026-10` key, then verify using the embedded public key.
The private key stays outside the checkout and build environment.

The fork's GitHub Actions remain disabled. The inherited publishing workflows
must be adapted before enabling them: they assume upstream publishing identities.
Do not use upstream signing keys, Docker Hub credentials, or npm identities.

## Verification

Run typechecks and unit tests for manager, sandbox, schema, pack, cf-api,
installer and CLI. Also run the release-script tests with
`scripts/vitest.config.ts`. DOM tests assume `TZ=UTC`. Cloudflare's Worker test
pool reads the manager's local `.dev.vars`; temporarily move browser-fixture
variables out of its discovery path for unit tests and restore them afterward.
Do not delete or expose fixture credentials. For local runs, leave `CI` unset so
the configured local Worker concurrency cap applies.

Completed isolated live checks include public repository import, a healthy
container update, repeated failed-update recovery, Chrome and Aside catalogue
checks, and a real D1 schema-only upgrade rehearsal. The rehearsal starts from
production schema version 13 with synthetic rows, upgrades to version 14,
repeats without changes, and confirms an older migrator leaves the newer schema
and synthetic rows intact. It does not prove the complete old application works
against the upgraded database.

Hostname tracing passed a complete staging UI test on October 24, 2026.
An expiring account-owned token carried Workers Scripts Read, Zone Read and
Zone Observability Write; zone permissions were limited to `ignitabull.org`.
The account token API (`/accounts/{account_id}/tokens`) worked through the
connector even though the user-token API and Wrangler OAuth scopes did not.

Aside enabled the exact `appflare-readiness.ignitabull.org` rule at 10%, with
zero default sampling for other hosts. Forty bounded staging requests returned
HTTP 200. Cloudflare returned stored `cloudflare_request` traces with six
edge-processing spans. Chrome observed the enabled switch and disabled it;
Aside confirmed the disabled state. The original zone settings and empty rules
were then restored, the original staging credential reinstated, and the test
token revoked and verified absent. The production Worker version, full settings,
bindings, custom-host DNS and wildcard DNS matched the baseline. Hostname tracing
remains disabled after validation. Worker trace ingestion and its switches also
passed in the preceding test round.

## Production deployment preparation

Production Worker `appflare` is in account
`2b66aa2be0f7116c930a57acb4f0fc8e`. Its pre-release active version was
`41be888f-69d7-42ba-beb4-b39219e7e224`. After Jeremy approved production
deployment, signed manager .2 was deployed on October 24, 2026 as version
`c6b0215b-4bee-4a88-8f2c-02807ca7a3d6` at 100% traffic. A fresh D1 recovery
bookmark was captured first. Fresh password login in Chrome, passkey login in
Aside, both AI catalogues (24 of 139 apps), authenticated reloads and HTTPS
health probes passed with schema 14. The original bindings, secrets, storage,
schedule, logging and domain settings were preserved. No rollback or password
reset was needed. Re-read the current version before any future deployment.
Preserve D1 `b3afcada-c5da-47d0-93a5-2d73665ec747`, KV
`2fc38833387040cd9481ed91730349e7`, workflow `appflare-jobs`, and SELF service
`appflare` entrypoint `JobUnits`. Preserve existing secret bindings in place;
do not copy staging passwords, tokens, database rows, or test-only OAuth code.
Preserve the installer-origin/install-source variables and production routes,
DNS, authentication, compatibility flags, scheduled jobs and logging settings.

Configure `MANAGER_RELEASES_URL` for the fork before enabling self-updates.
The fork sandbox version is pinned by digest in `packages/schema/src/sandbox.ts`.
Its image was built from commit `1dd21d5f2c27a41696d5632f4601d99008276ab5`
and validated in private GitHub Actions run 40128034458, then published to the
Ignitabull Cloudflare registry. The later manager/Worker release commit adds the
pin to that independently built image. This two-stage provenance avoids requiring
an image to contain its own future digest. No upstream image tag is overwritten.
Older upstream versions retain their existing image lookup; an unpinned fork
version is refused. This image is available only in the Ignitabull account.

The independent signing key has fingerprint
`SHA256:XmdoUMaTLuZK7FthijSNcKWzQRO1y8ZhVdCzOz9X7ik`. Upstream verification
keys are retained for catalog compatibility. The pre-release production manager
did not trust the fork key. The separately approved direct deployment of the
reviewed signed manager .2 completed that bootstrap; production now includes
the fork verification key. The signed sandbox and initial manager releases were published as prereleases,
and all six anonymous GitHub asset downloads passed integrity and signature checks.
Manager .2 corrects the waiting Workflow binding handoff through SELF RPC, and
adds bounded retries for fresh Worker version visibility (10007/100146) and
Containers namespace propagation (1606 DURABLE_OBJECT_NOT_FOUND). Only a
successful upload in the same job permits the new absence retries. Permission
and unrelated validation failures remain terminal. Manager .2 is published as a signed prerelease from commit
`2d40551f5f5a8124601dd893d53c78a68b6e34b6`. Anonymous GitHub downloads and
the final cold setup plus original waiting repository build passed in staging.
Both Workflows completed; Chrome and Aside showed Ready to install. The final
source passes 5,152 manager tests across 441 files and manager typechecking.
When deployment lookup reports 10007 while the binding answers, settlement
requires repeated live version answers; a missing/unversioned binding cannot
supply that proof. The follow-up full-capacity cold rollout passed on October 24,
2026 with the published 2/1/2/2 limits unchanged. All seven instances were healthy;
automatic setup and the original waiting repository build both completed without
a restart. Chrome and Aside showed Ready to install with the expected commit and
image. No executable changes were needed. This closes the cold-rollout gate;
it does not constitute a seven-concurrent-workload stress test. The earlier spare
instance delay remains recorded in the test history. All disposable
auto-test resources and review files were removed, the original staging service
binding and zero container caps were restored, and production stayed unchanged. Keep inherited Actions disabled; they target upstream
publishing identities.

Before an approved production deployment, capture a fresh D1 Time Travel bookmark,
active Worker version and binding/settings receipt. Deploy only the reviewed
artifact with the live production bindings. Validate login, AI catalogue and a
bounded operational probe in Chrome and Aside. If application verification
fails, restore the captured Worker version. Do not automatically restore the
whole database: schema migration is additive, and database restoration could
discard later writes. Use a database restore only after assessing changes and
obtaining approval for its exact scope.

The earlier intermittent Chrome HTTP 403 has no proven root cause yet. Improved
error handling and container recovery must not be represented as preventing it.
