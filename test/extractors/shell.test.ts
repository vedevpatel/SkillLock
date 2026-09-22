import { describe, expect, it } from 'vitest';

import { extract, findingFor, valuesOf } from './helpers.js';

describe('shell extractor', () => {
  it('normalizes commands to binaries', () => {
    const findings = extract(
      'scripts/a.sh',
      [
        'git commit -m "x"',
        'curl https://foo.example/x | jq .',
        'npm install',
        'python foo.py',
        'git push',
      ].join('\n'),
    );
    expect(valuesOf(findings, 'shell')).toEqual(['curl', 'git', 'jq', 'npm', 'python']);
  });

  it('finds commands launched from Python', () => {
    const findings = extract(
      'scripts/a.py',
      [
        'subprocess.run(["git", "status"])',
        'subprocess.Popen(["curl", "-s", "https://x.example"])',
        'os.system("npm install")',
      ].join('\n'),
    );
    expect(valuesOf(findings, 'shell')).toEqual(['curl', 'git', 'npm']);
  });

  it('finds commands launched from Node', () => {
    const findings = extract(
      'scripts/a.js',
      ['execSync("git status");', 'spawn("npm", ["test"]);', 'execFileSync("jq", ["."]);'].join('\n'),
    );
    expect(valuesOf(findings, 'shell')).toEqual(['git', 'jq', 'npm']);
  });

  it('looks inside bash -c', () => {
    const findings = extract('scripts/a.sh', 'bash -c "curl https://foo.example/x"\n');
    expect(valuesOf(findings, 'shell')).toEqual(['bash', 'curl']);
  });

  it('reads commands out of a labelled Markdown fence', () => {
    const findings = extract(
      'SKILL.md',
      ['# Skill', '', '```bash', 'git clone https://github.com/a/b', 'npm install', '```', ''].join('\n'),
    );
    expect(valuesOf(findings, 'shell')).toEqual(['git', 'npm']);
    expect(findingFor(findings, 'shell', 'git')?.confidence).toBe('medium');
  });

  it('requires a recognizable binary in an unlabelled fence', () => {
    const findings = extract(
      'SKILL.md',
      ['```', 'git status', 'this is just prose about status', '```', ''].join('\n'),
    );
    expect(valuesOf(findings, 'shell')).toEqual(['git']);
  });

  it('ignores shell builtins and control flow', () => {
    const findings = extract(
      'scripts/a.sh',
      ['set -euo pipefail', 'if [ -f x ]; then', '  echo hi', 'fi', 'cd /tmp', 'export FOO=1'].join('\n'),
    );
    expect(valuesOf(findings, 'shell')).toEqual([]);
  });

  it('reports a computed command as dynamic', () => {
    const findings = extract('scripts/a.py', 'subprocess.run(command)');
    expect(valuesOf(findings, 'shell')).toEqual(['<dynamic>']);
  });

  it('finds the command inside a substitution', () => {
    const findings = extract('scripts/a.sh', 'VERSION=$(git describe --tags)\n');
    expect(valuesOf(findings, 'shell')).toEqual(['git']);
  });

  it('does not read commands out of prose', () => {
    const findings = extract('SKILL.md', 'Use git to clone the repository.\n');
    expect(valuesOf(findings, 'shell')).toEqual([]);
  });
});
