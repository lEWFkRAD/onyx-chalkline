# Dependency security status

Reviewed 2026-10-05. This root web update does not change or deploy the separate classroom application.

React/RSC, Vite, Vinext and Cloudflare tooling now use patched releases. Scoped overrides select esbuild 0.25.12 beneath @esbuild-kit/core-utils and fflate 0.7.5 beneath satori. Remove these overrides once the parents select safe versions themselves.

## Outstanding upstream advisory

GHSA-vfj7-8cjw-p6xm affects braces 3.0.3, the latest published release at review time. Deeply nested patterns can exhaust the stack. ESLint and Vinext build tooling pull it through micromatch/fast-glob. npm reports seven affected package nodes for this one underlying advisory.

No advisory is ignored or dismissed. The full development audit is NOT clean. Avoid untrusted glob patterns in build/lint and do not expose development servers. Update when a compatible upstream patch exists; npm's suggested major downgrades are not an automatic solution. Package classification is not proof that vulnerable code cannot enter a bundle.

Run npm audit --include=dev for the outstanding finding; npm audit --omit=dev checks the production package set.

## Verified locally

Clean install, production build, all ten Node tests, lint, synthetic Drizzle SQL generation and production audit passed. Rendered HTML runs in Wrangler's local Worker test harness with real cloudflare: imports and bindings. No physical-device or deployment verification is claimed.
