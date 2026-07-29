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
  closeGlyph: '×',

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
