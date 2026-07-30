// Every user-facing string the manager renders.
//
// Collected rather than inlined for two reasons. The loader has no translation
// layer yet and this is the list it will need. And the manager is the surface a
// player reaches when something is already wrong, so the wording of a failure
// state is worth being able to read in one place rather than hunting through
// three components.

export const UI_TEXT = {
  title: 'Addons',
  close: 'Close',
  /** The accessible name is `close`; this is only what the button draws. */

  installedLoading: 'Reading the registry.',
  installedEmpty: 'No addons installed yet.',
  installedUnreachable: 'The loader is not connected to its storage.',
  enabled: 'Enabled',
  disabled: 'Disabled',
  by: 'by',

  configure: 'Configure',
  back: 'Back to the list',
  configLoading: "Reading this addon's settings.",

  settingsHeading: 'Settings',
  settingsNone: 'This addon declares no settings.',

  keybindsHeading: 'Keys',
  keybindsNone: 'This addon declares no keybinds.',
  rebind: 'Change the key for',
  resetBind: 'Reset',
  pressAKey: 'Press a key',
  comboUnusable: 'That combination cannot be bound.',
  conflictPrefix: 'Also bound to',
  conflictApproximate:
    'Read from saved bindings only, so keys the player has never changed are not listed.',

  logsHeading: 'Log',
  logsEmpty: 'This addon has not logged anything.',

  statusRunning: 'Running',
  statusStopped: 'Stopped',
  statusFailed: 'Failed',
  statusIncompatible: 'Incompatible',

  reload: 'Reload',
  reloadRunning: 'Stop this addon and evaluate its source again.',
  reloadNeedsEnabled: 'Reload re-evaluates a running addon. Enable it first.',
  uninstall: 'Uninstall',
  uninstallConfirm: 'Uninstall this addon? Its settings and window positions are kept.',

  catalogUnreachable: 'The loader is not connected to its storage.',
  catalogLoading: 'Reading the marketplaces.',
  refresh: 'Refresh',

  browseSearch: 'Search',
  browseSearchPlaceholder: 'name, author, or description',
  browseTag: 'Category',
  browseAllTags: 'All',
  browseEmpty: 'No marketplace has been read yet. Refresh to fetch their indexes.',
  browseNoMatch: 'Nothing here matches that search.',
  browseInstall: 'Install',
  browseInstalled: 'Installed',
  browseInstallHint: 'Show what this addon declares, then install it.',
  browseInstalledHint: 'This addon is already in your Installed list.',

  confirmHeading: 'Install',
  confirmFrom: 'From',
  confirmPermissions: 'This addon says it needs to',
  confirmNoPermissions: 'This addon declares no permissions.',
  confirmTrust:
    'The declared list is what the author says the addon is for, not a limit the ' +
    'loader enforces. Addon code runs with the same access to this page that the ' +
    'game itself has, including your login token. Install what you would trust as ' +
    'a browser extension.',
  confirmInstall: 'Install',
  confirmCancel: 'Cancel',

  marketsHeading: 'Marketplaces',
  marketsBuiltin: 'Ships with the loader and cannot be removed or repointed.',
  marketsOfficialNote:
    'Official to this loader, not to the game. World of ClaudeCraft is a separate ' +
    'project under a different owner and does not endorse it.',
  marketsRef: 'Ref',
  marketsAddons: 'Addons',
  marketsLastRead: 'Index read',
  marketsNever: 'not yet',
  marketsRemove: 'Remove',
  marketsRemoveConfirm:
    'Remove this marketplace? Addons installed from it keep working from their cached source.',
  marketsPin: 'Pin',
  marketsPinPlaceholder: 'tag, branch, or commit',
  marketsDegraded:
    'This repository publishes no marketplace.json, so the loader listed its addons ' +
    'one at a time. That costs a request per addon against a shared hourly limit. ' +
    'Ask its maintainer to generate an index.',
  marketsAddHeading: 'Add a marketplace',
  marketsAddUrl: 'Repository',
  marketsAddUrlPlaceholder: 'owner/repo or a github.com URL',
  marketsAddRef: 'Pin to (optional)',
  marketsAdd: 'Add',
  marketsAddWarning:
    'Addons from a marketplace you add are code you are choosing to run. They can ' +
    'read your login token and act as your account. Pin the source to a tag rather ' +
    'than a branch so its code cannot change under you.',

  updatesHeading: 'Updates',
  updatesNone: 'Everything is at the version its marketplace offers.',
  updatesAuto:
    'Auto-update is off for every marketplace, including the official one. An addon ' +
    'update is a code change, so nothing is fetched until you ask for it.',
  updatesStale: 'Compared against the indexes as they were last read. Refresh to re-read them.',
  updatesUpdate: 'Update',
  updatesUpdateAll: 'Update all',
  updatesPin: 'Pin here',
  updatesPinHint: 'Stay on this version and stop offering the update.',
  updatesUnpin: 'Unpin',
  updatesPinned: 'Pinned',
  updatesArrow: 'to',

  devIntro:
    'Serves addons/ from this repository over http on the loopback interface. ' +
    'Run "pnpm serve" next to the game and this becomes a marketplace like any other.',
  devEnabled: 'Use the local dev server',
  devHotReload: 'Reload an addon when its file changes',
  devHotReloadNote:
    'Polls each running local addon for a new body. An unchanged file answers 304 and costs nothing.',
  devOrigin: 'Origin',
  devLastRead: 'Index read',
  devNever: 'not yet',
  devOff: 'Turn the local dev server on to add it to the marketplace list.',
  devInBrowse: 'What this server offers is in Browse, under "Local dev server".',
  devRefresh: 'Refresh',
  devReloadAll: 'Reload all',
  devUnreachable: 'The loader is not connected to its storage, so dev mode is unavailable.',
  devFreeze: 'Freeze every addon window',
  devFreezeNote:
    'Holds every timer, world watch and socket handler the loader hands an addon, and pauses ' +
    'animation, so a window stops moving and can be read or photographed. Socket traffic and ' +
    'world changes during a freeze are dropped rather than queued, so a meter under-counts ' +
    'across one and "Reload all" resets it. This is never saved, so reloading the page always ' +
    'unfreezes.',

  anchorsHeading: 'Game anchors',
  anchorsNote:
    'The game owes the loader no compatibility for these. One that is not present is ' +
    'expected while the surface it belongs to is closed, and a fault while it is open.',
  anchorFound: 'found',
  anchorMissing: 'not present',
  probeMissingPrefix: 'Missing from the game object: ',

  channel: 'Channel',
  origin: 'Origin',
  loader: 'Loader',
  game: 'Game',
  bridge: 'Bridge',
  probe: 'Probe',
  socket: 'Socket',
  tick: 'Tick',
  latency: 'Latency',
  reconnects: 'Reconnects',

  bridgeConnected: 'connected',
  bridgeMissing: 'not connected',
  gameUnreadable: 'not readable',
  probeUnread: 'not read yet, the game has not reached world entry',
  socketClosed: 'closed',
  latencyUnmeasured: 'not measured yet',
  unknown: 'unknown',
} as const;
