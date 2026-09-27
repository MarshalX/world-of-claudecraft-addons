---
paths:
  - ".github/workflows/**"
  - "loader/src/shared/api-version.ts"
  - "packages/types/**"
  - "addons/**"
  - "CHANGELOG.md"
  - "cliff.toml"
  - "package.json"
  - "vite.config.ts"
  - "tools/artifact.ts"
---

# Versioning and release

Part of `AGENTS.md`, split out because it applies only to the paths above. Everything in `AGENTS.md` still holds here.

- **`@name` and `@namespace` are FROZEN**: a manager keys the script and its whole GM store on them, so a change installs an empty second script. `release.yml` greps the built block for both.
- **`API_MINOR` moves on the first additive merge after the current one has SHIPPED IN A RELEASE TAG**; until then additive merges ride it. Check with `git tag --contains <the commit that set it>`. A member changing shape or leaving moves `API_VERSION`. **Widening a union an addon only READS is additive** (`ResourceType` gaining `'focus'`).
- **`apiMinor` counts PUBLISHED MEMBERS**, record fields included: declare the smallest minor carrying every member read. **Never reason from passthrough**: nothing promises it, and an under-declared addon reads `undefined` silently where an over-declared one is refused with a message.
- **An addon's `version` is the ONLY thing that ships it.** `host/updates.ts` offers only newer versions, so an unbumped change reaches fresh installs and nobody else. Check the whole branch's set of changed addons, and bump only on what a player can observe.
- **The git tag is the only source of a release version.** `package.json` stays `0.0.0`; `release.yml` sets the version from the dispatch input and greps `@version` out of both built files.
- **A release is ONE BUTTON** (`workflow_dispatch` in `release.yml`), and the run creates the tag, because `GITHUB_TOKEN` events start no workflows and the alternative is a long-lived token. Everything that can fail runs before the tag push. The drift guard refuses when `marketplace.json` rows do not match the tagged commit; wait for the bot rather than regenerating. It compares rows, not `generated`.
- **There is no npm token and there must not be one**: write tokens now expire within 90 days, so a secret would fail on release day. The `types` job uses TRUSTED PUBLISHING. npm matches the WORKFLOW FILENAME, so the publish step cannot move files without editing npmjs.com and cannot live in a `workflow_call` workflow. The publisher needs `npm publish` allowed, and `setup-node`'s `registry-url` stays unset because its placeholder token blocks OIDC.
- **There is ONE canonical artifact**: the Release asset via `releases/latest/download`. `loader/dist/` is never committed. `@updateURL` points at `woc-loader.meta.js`; both files are built and attached together.
- **A published release is immutable**: fix with a patch tag; delete only within minutes of publishing.
- **`CHANGELOG.md` is generated from commit titles, and the VERB is the category**, so lead with it. `tag_pattern` is `v[0-9]*` so `types-v*` tags do not split sections.
