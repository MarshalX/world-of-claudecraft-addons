// `pnpm readme`: regenerate the addon section of README.md from the manifests.
//
// `--check` reports drift and writes nothing, for a person who wants to know
// before running it. Nothing in CI uses it: the section is regenerated on main by
// .github/workflows/marketplace.yml in the same commit as the marketplace index,
// and, like the index, a contributor is never asked to run this before pushing.
// A test comparing the committed file against a fresh render used to exist and
// was removed, because it made a bot-owned file fail the build for the very
// change the bot exists to handle.
//
// A README with NO markers is "nothing to generate here" rather than an error,
// and that is about somebody else's repository rather than this one. The workflow
// that runs this is the one site/content/docs/publishing.md tells a third-party
// marketplace to copy, and their README has no addon section in it; failing their
// CI on the absence of a thing they never asked for is not a check, it is a trap.
// `spliceReadme` still throws, so a marker deleted from THIS file is caught by the
// suite, where the loss is real.

import { writeFileSync } from 'node:fs';
import process from 'node:process';
import { readAddons } from './catalog.ts';
import { END, README, readReadme, renderAddons, START, spliceReadme } from './readme-core.ts';

function main() {
  const check = process.argv.includes('--check');
  const current = readReadme();
  if (!(current.includes(START) && current.includes(END))) {
    console.log('readme: no generated addon section in README.md, nothing to do');
    return;
  }
  const next = spliceReadme(current, renderAddons(readAddons()));
  if (next === current) {
    console.log('readme: already up to date');
    return;
  }
  if (check) {
    console.error('readme: README.md is out of date; run `pnpm readme`');
    process.exitCode = 1;
    return;
  }
  writeFileSync(README, next);
  console.log('readme: rewrote the addon section of README.md');
}

/** Errors reach here from any stage, and only the message is useful. */
function messageOf(error) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

try {
  main();
} catch (error) {
  console.error(`readme: ${messageOf(error)}`);
  process.exitCode = 1;
}
