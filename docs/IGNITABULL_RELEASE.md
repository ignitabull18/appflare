# Ignitabull release candidate

This fork is maintained at `ignitabull18/appflare`, branch
`fix/cloudflare-readiness-and-recovery`. Production deployment requires Jeremy's
approval after the candidate and its checks have been reviewed. No release,
production deployment, or automatic update is authorized by this document.

## Candidate artifacts

Manager version: `0.6.0-ignitabull.1`; sandbox version:
`0.2.0-ignitabull.1`. Build from a clean committed checkout with pnpm 10.34.5.
Use `--repository ignitabull18/appflare` with `scripts/release-pack.ts` for both
artifacts. The artifact source SHA must equal the tested fork commit. Local packs
are unsigned review artifacts, not signed releases accepted by automatic updates.

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

Hostname trace settings and an exact staging-host rule were enabled, read back,
disabled and restored using the Cloudflare connector. The CLI credential returns
403 for zone tracing. A complete manager UI test using a credential with the
necessary tracing permissions and confirmation of persisted trace ingestion
remain outstanding. Keep tracing disabled until then.

## Production deployment preparation

Production Worker `appflare` is in account
`2b66aa2be0f7116c930a57acb4f0fc8e`. Its baseline active version is
`41be888f-69d7-42ba-beb4-b39219e7e224`. Re-read immediately before deployment.
Preserve D1 `b3afcada-c5da-47d0-93a5-2d73665ec747`, KV
`2fc38833387040cd9481ed91730349e7`, workflow `appflare-jobs`, and SELF service
`appflare` entrypoint `JobUnits`. Preserve existing secret bindings in place;
do not copy staging passwords, tokens, database rows, or test-only OAuth code.
Preserve the installer-origin/install-source variables and production routes,
DNS, authentication, compatibility flags, scheduled jobs and logging settings.

Configure `MANAGER_RELEASES_URL` for the fork before enabling self-updates.
Do not enable sandbox auto-install/update yet: it still depends on a trusted
signed release and an explicitly chosen immutable container image. The current
schema's default image repository belongs to upstream. The tested staging image
is evidence, not a published fork image. Create a fork signing and image
publishing process before claiming those automatic paths work.

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
