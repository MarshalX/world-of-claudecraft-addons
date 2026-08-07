/// <reference types="@woc-addons/types" />

// A keyed list, from the set that changes to the rows on screen.
//
// A real file rather than prose in a template, so it is linted like everything
// else and cannot drift from the API it claims to demonstrate. The API page
// includes the `list` region; nothing else here is shown anywhere.
//
// It is also the shape three members were built for at once: the list owns which
// rows exist, `woc.paint` owns when they are redrawn, and `woc.fmt` owns what the
// figures say. Written without them this is a Map, a reconcile pass, a boolean
// beside a `requestAnimationFrame` and a division by 60.

/** As many rows as the panel holds. Everything else stays measured, off screen. */
const MAX_ROWS = 8;

// #region list
const frame = woc.ui.frame({ id: 'nodes', title: 'Harvested' });

/** Every node still on cooldown, soonest ready first. */
function cooling() {
  const nodes = woc.world.nodeCooldowns ?? new Map();
  return [...nodes].map(([id, left]) => ({ id, left })).sort((one, other) => one.left - other.left);
}

const rows = woc.ui.list({
  parent: frame.body,
  key: (node) => node.id,
  create: (node) => woc.ui.bar({ label: woc.fmt.titleCase(node.id) }),
  update: (bar, node) => {
    bar.update({ value: woc.fmt.duration(node.left) });
  },
  shown: (_node, index) => index < MAX_ROWS,
});

// Ask for a repaint whenever something changed; it is drawn once a frame at most,
// and not at all while the panel is hidden.
const repaint = woc.paint(
  () => {
    rows.sync(cooling());
  },
  { frame },
);

woc.world.on('nodeCooldowns', repaint);
// #endregion
