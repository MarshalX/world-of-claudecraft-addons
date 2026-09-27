---
paths:
  - "loader/src/host/**"
  - "loader/src/shared/marketplace.ts"
  - "loader/src/runtime/ui/manager/**"
  - "tools/serve*"
  - "tools/dev.mjs"
  - "tools/index.mjs"
  - "tools/readme*"
  - "tools/catalog.ts"
  - "tools/featured.ts"
  - "tools/manifests.ts"
  - "tools/site/**"
  - "marketplace.json"
  - "README.md"
  - ".github/workflows/marketplace.yml"
  - "addons/*/addon.json"
---

# The marketplace, the dev server and the manager

Part of `AGENTS.md`, split out because it applies only to the paths above. Everything in `AGENTS.md` still holds here.

- **The official marketplace cannot be removed**; `canRemoveMarketplace` runs in the host.
- **The local dev origin is a build-time constant** (`LOCAL_ORIGIN` in `shared/marketplace.ts`, in `@connect`) that `normalizeMarketplaceUrl` rejects as input. `MarketplaceSource` is a union so callers must say which kind they hold.
- **A marketplace id is re-derived on read** by `fromStored`; only owner, repo and ref are stored, because the id is the storage namespace of every addon from it.
- **The dev watcher polls BODIES, never the index**, which would repaint the manager every tick.
- **The dev server serves the loader on ONE EXACT PATH** (`resolveLoader`, name in `tools/artifact.ts`), and installing over http avoids the `file://` permission.
- **The dev index `generated` stamp is an mtime**, so ETags can answer 304.
- **The contents-API fallback runs only on a 404 for a repository.** A 403 is the rate limit and must not trigger a request per addon. Too many directories is REFUSED, never truncated.
- **`MarketApi.setRef` moves the ref, never the id**, and drops cached rows.
- **Nothing about an addon is written anywhere but its manifest.** The site and README read it through `tools/catalog.ts`; never add a second description. The only editorial choice is which four get pictures (`tools/featured.ts`).
- **`development`-tagged addons ship in Browse but not on the site catalog or README list**, and both publishers name what they omit.
- **A generated file is owned by the BOT or a contributor, never both.** `marketplace.json` and the README section belong to the bot and have no freshness test; the README markers are tested, because their absence silently stops the generator.
- **ONE job (`.github/workflows/marketplace.yml`) regenerates both in one commit**, since two would race on push; its title becomes a changelog line.
- **Never hand-edit `marketplace.json`.** The dev server builds its own index per request through the `pnpm validate` reader (`tools/serve-core.ts`).
- **The manager has three ways in**; `GM_registerMenuCommand` is host-side and works even when the runtime never connects, because the manager is how a player learns the loader is broken.
- **The manager fetches AT MOST ONCE A SESSION, and the once is not optional.** Reads answer from the host's cache; Refresh always fetches. `market.ensure` seeds it, awaited ahead of the reads in `catalog-store.ts`, because an unseeded `registry.updates` reports a false all-clear. The once-per-session refusal lives in the host, and a failed read counts as read.
- **A companion is a note with a route.** `companions` holds bare ids; `companionReasons` says what each ADDS, tied by `AddonManifest.refine`. It is a second key rather than a richer shape because one unreadable entry fails an older loader's whole index parse, while an unknown key is dropped. It gates nothing; its actions reuse existing controls. The pending row resolves against every row, and Browse's search lives in `ManagerApp` so the tab switch keeps it.
- **A pin means "stop offering"**: `registry.setPin` fetches nothing, removes the addon from updates, and the row stays visible.
