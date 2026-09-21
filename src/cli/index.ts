#!/usr/bin/env node
/**
 * skilllock init    scan a directory and write skilllock.json
 * skilllock verify  re-scan, diff against the lockfile, fail on expansion
 * skilllock inspect explain the current authority and its evidence
 */

import { Command } from 'commander';

import { EXIT_ERROR, printError } from './common.js';
import { runInit } from './init.js';
import { runInspect } from './inspect.js';
import { runVerify } from './verify.js';

const VERSION = '0.1.0';

const DESCRIPTION = `git diff for what your Agent Skills touch.

SkillLock records the resources a skill statically references and tells you when
that surface changes. It is not a malware scanner and makes no claim about
whether a skill is safe.`;

export function buildProgram(): Command {
  const program = new Command();

  program
    .name('skilllock')
    .description(DESCRIPTION)
    .version(VERSION, '-v, --version')
    .showHelpAfterError();

  program
    .command('init')
    .description('scan a skill directory and write a deterministic skilllock.json')
    .argument('[directory]', 'skill directory', '.')
    .option('--lockfile <path>', 'write the lockfile somewhere other than <directory>/skilllock.json')
    .option('--json', 'print the manifest instead of a summary')
    .action((directory: string, options: { lockfile?: string; json?: boolean }) => {
      process.exitCode = runInit({
        directory,
        ...(options.lockfile !== undefined ? { lockfile: options.lockfile } : {}),
        ...(options.json !== undefined ? { json: options.json } : {}),
      });
    });

  program
    .command('verify')
    .description('re-scan and fail if the skill gained authority (exit code 2)')
    .argument('[directory]', 'skill directory', '.')
    .option('--lockfile <path>', 'read the lockfile from somewhere other than <directory>/skilllock.json')
    .option('--strict', 'also fail on low-confidence additions such as documentation examples')
    .option('--json', 'print the diff as JSON')
    .action((directory: string, options: { lockfile?: string; strict?: boolean; json?: boolean }) => {
      process.exitCode = runVerify({
        directory,
        ...(options.lockfile !== undefined ? { lockfile: options.lockfile } : {}),
        ...(options.strict !== undefined ? { strict: options.strict } : {}),
        ...(options.json !== undefined ? { json: options.json } : {}),
      });
    });

  program
    .command('inspect')
    .description('explain the authority this skill currently references, with evidence')
    .argument('[directory]', 'skill directory', '.')
    .option('--min-confidence <level>', 'hide items below this confidence (high, medium, low)')
    .option('--json', 'print the manifest as JSON')
    .action((directory: string, options: { minConfidence?: string; json?: boolean }) => {
      process.exitCode = runInspect({
        directory,
        ...(options.minConfidence !== undefined ? { minConfidence: options.minConfidence } : {}),
        ...(options.json !== undefined ? { json: options.json } : {}),
      });
    });

  return program;
}

export function main(argv: readonly string[] = process.argv): void {
  try {
    buildProgram().parse([...argv]);
  } catch (error) {
    printError(error);
    process.exitCode = EXIT_ERROR;
  }
}

main();
