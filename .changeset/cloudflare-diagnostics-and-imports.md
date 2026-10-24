---
"@appflare/manager": minor
"@appflare/sandbox-worker": minor
"@appflare/schema": minor
"@appflare/pack": minor
"@appflare/cf-api": minor
"@appflare/installer": patch
"create-appflare": patch
---

Add scoped Cloudflare diagnostics and private server source maps, confirmed D1 deletion recovery, exact repository build-tool pins and runtime checks, and opt-in stateless published-image container imports with rollout recovery. Pair the patched Sandbox SDK and digest-pinned build image, update Wrangler, and add format-7 readers and release validation. Existing format-1 artifacts remain readable; bootstrap older managers with an approved direct deployment before publishing format-7 artifacts. Build and verify the matching sandbox image and complete staged acceptance before production rollout.
