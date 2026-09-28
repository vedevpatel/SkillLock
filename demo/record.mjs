#!/usr/bin/env node
/**
 * Records the definition-of-done scenario from real command output:
 *
 *   skilllock init ./demo-weather-skill
 *   git merge malicious-update        (an upstream update arriving)
 *   skilllock verify ./demo-weather-skill
 *
 * Every command shown is the command that ran. The skill lives in a throwaway
 * git repository with a `malicious-update` branch, and `skilllock` on PATH is a
 * shim for this checkout's dist/cli/index.js.
 *
 * Writes demo/demo.cast (asciinema v2; `asciinema play demo/demo.cast`) and
 * demo/demo.svg (animated, renders inline on GitHub).
 *
 * Usage: npm run build && node demo/record.mjs
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..');
const cli = path.join(repoRoot, 'dist', 'cli', 'index.js');
const fixtures = path.join(repoRoot, 'test', 'fixtures');

const COLUMNS = 104;
const ROWS = 34;

/* -------------------------------------------------------------------------- */
/* set up a real repository                                                   */
/* -------------------------------------------------------------------------- */

const work = mkdtempSync(path.join(tmpdir(), 'skilllock-demo-'));
const bin = path.join(work, 'bin');
const project = path.join(work, 'project');
const skill = path.join(project, 'demo-weather-skill');

mkdirSync(bin, { recursive: true });
const shim = path.join(bin, 'skilllock');
writeFileSync(shim, `#!/bin/sh\nexec "${process.execPath}" "${cli}" "$@"\n`);
chmodSync(shim, 0o755);

const env = {
  ...process.env,
  PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`,
  NO_COLOR: '1',
  FORCE_COLOR: '0',
  GIT_AUTHOR_NAME: 'demo',
  GIT_AUTHOR_EMAIL: 'demo@example.com',
  GIT_COMMITTER_NAME: 'demo',
  GIT_COMMITTER_EMAIL: 'demo@example.com',
};

const git = (...args) => execFileSync('git', args, { cwd: project, env, stdio: 'pipe' });

mkdirSync(project, { recursive: true });
cpSync(path.join(fixtures, 'weather'), skill, { recursive: true });
git('init', '-q', '-b', 'main');
git('add', '.');
git('commit', '-q', '-m', 'weather skill');
git('checkout', '-q', '-b', 'malicious-update');
cpSync(path.join(fixtures, 'weather-malicious', 'scripts'), path.join(skill, 'scripts'), {
  recursive: true,
});
git('commit', '-q', '-am', 'Improve forecast caching');
git('checkout', '-q', 'main');

/* -------------------------------------------------------------------------- */
/* run the scenario                                                           */
/* -------------------------------------------------------------------------- */

const script = [
  { command: 'skilllock init ./demo-weather-skill', pause: 1.6 },
  { command: 'git add demo-weather-skill/skilllock.json && git commit -qm "Lock skill authority"', pause: 0.8 },
  // Merged, not checked out: the update branch predates the lockfile commit, so
  // checking it out would remove the lockfile. Pulling an update merges it.
  { command: 'git merge -q --no-edit malicious-update', pause: 1.0 },
  { command: 'skilllock verify ./demo-weather-skill', pause: 1.2 },
  { command: 'echo "exit code: $?"', pause: 3.0 },
];

/** @type {Array<[number, 'o', string]>} */
const events = [];
/** Lines as they appear on screen, for the SVG. */
const lines = [];
let clock = 0.4;
let lastStatus = 0;

const emit = (text, delay) => {
  clock += delay;
  events.push([round(clock), 'o', text]);
};

for (const step of script) {
  const prompt = '$ ';
  emit(prompt, 0.2);
  // Typed one character at a time, at a fixed rate so the recording is reproducible.
  for (const char of step.command) emit(char, 0.035);
  emit('\r\n', 0.25);
  lines.push({ text: `${prompt}${step.command}`, prompt: true, at: clock });

  const command = step.command.replace('$?', String(lastStatus));
  const result = spawnSync('/bin/sh', ['-c', command], { cwd: project, env, encoding: 'utf8' });
  lastStatus = result.status ?? 1;
  const output = `${result.stdout}${result.stderr}`.replace(/\n+$/, '');

  if (output) {
    for (const line of output.split('\n')) {
      emit(`${line}\r\n`, 0.03);
      lines.push({ text: line, prompt: false, at: clock });
    }
  }
  clock += step.pause;
}

if (lastStatus !== 0) {
  console.error('the final echo failed; the recording is not trustworthy');
  process.exit(1);
}

/* -------------------------------------------------------------------------- */
/* asciinema v2                                                               */
/* -------------------------------------------------------------------------- */

const header = {
  version: 2,
  width: COLUMNS,
  height: ROWS,
  title: 'SkillLock: authority drift in a skill update',
  env: { SHELL: '/bin/sh', TERM: 'xterm-256color' },
};
writeFileSync(
  path.join(here, 'demo.cast'),
  `${[JSON.stringify(header), ...events.map((event) => JSON.stringify(event))].join('\n')}\n`,
);

/* -------------------------------------------------------------------------- */
/* animated SVG                                                               */
/* -------------------------------------------------------------------------- */

const total = clock + 2;
const lineHeight = 17;
const charWidth = 8.4; // generous: Menlo, SF Mono and Consolas differ at 13px
const padding = 16;
const titleBar = 28;
// The SVG is a page, not a scrolling terminal: it is sized to show every line.
const visible = lines;
const offset = 0;
// Wide enough for the longest captured line, so evidence snippets are never clipped.
const longest = Math.max(COLUMNS, ...lines.map((line) => [...line.text].length));
const width = Math.ceil(longest * charWidth + padding * 2);
const height = titleBar + padding * 2 + visible.length * lineHeight;

const colorFor = (line) => {
  if (line.prompt) return '#e6edf3';
  const text = line.text.trimStart();
  if (text.startsWith('⚠')) return '#d29922';
  if (text.startsWith('✗')) return '#f85149';
  if (text.startsWith('✓')) return '#3fb950';
  if (text.startsWith('+ ')) return '#3fb950';
  if (/^\S+:\d+/.test(text)) return '#58a6ff';
  return '#adbac7';
};

const rows = visible
  .map((line, index) => {
    const y = titleBar + padding + (index + 1) * lineHeight - 4;
    return (
      `<text x="${padding}" y="${y}" fill="${colorFor(line)}" class="l">` +
      `${escapeXml(line.text) || ' '}</text>`
    );
  })
  .join('\n  ');

const keyframes = visible
  .map((line, index) => {
    const start = Math.min(99.5, (line.at / total) * 100).toFixed(2);
    return `.l:nth-of-type(${index + 1}){animation-name:k${index}}@keyframes k${index}{0%,${start}%{opacity:0}${(Number(start) + 0.01).toFixed(2)}%,100%{opacity:1}}`;
  })
  .join('\n');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Terminal recording of skilllock detecting authority drift">
<title>skilllock init, git merge malicious-update, skilllock verify</title>
<style>
.l{font:13px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;white-space:pre;opacity:0;animation-duration:${total.toFixed(1)}s;animation-iteration-count:infinite;animation-timing-function:step-end}
${keyframes}
@media (prefers-reduced-motion:reduce){.l{animation:none;opacity:1}}
</style>
<rect width="${width}" height="${height}" rx="8" fill="#0d1117"/>
<rect width="${width}" height="${titleBar}" rx="8" fill="#161b22"/>
<rect y="${titleBar - 8}" width="${width}" height="8" fill="#161b22"/>
<circle cx="18" cy="14" r="5" fill="#f85149"/><circle cx="36" cy="14" r="5" fill="#d29922"/><circle cx="54" cy="14" r="5" fill="#3fb950"/>
<g>
  ${rows}
</g>
</svg>
`;
writeFileSync(path.join(here, 'demo.svg'), svg);

rmSync(work, { recursive: true, force: true });
console.log(
  `wrote demo/demo.cast and demo/demo.svg (${lines.length} lines, ${total.toFixed(1)}s${offset ? `, first ${offset} lines scrolled off` : ''})`,
);

function round(value) {
  return Math.round(value * 1000) / 1000;
}

function escapeXml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
