// `pnpm readme`: regenerate the addon section of README.md from the manifests. The section is
// bot-owned (marketplace.yml), so no test compares it against a fresh render. `--check` reports
// drift and writes nothing; release.yml uses it to wait for the bot before tagging.
//
// A README with NO markers is nothing to do rather than an error, because third-party
// marketplaces copy the workflow that runs this and their README has no addon section.

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
