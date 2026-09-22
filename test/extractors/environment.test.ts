import { describe, expect, it } from 'vitest';

import { extract, findingFor, valuesOf } from './helpers.js';

describe('environment extractor', () => {
  it('finds Node, Deno and Python accesses', () => {
    const node = extract(
      'scripts/a.js',
      ['process.env.GITHUB_TOKEN', 'process.env["OTHER_TOKEN"]', 'Deno.env.get("DENO_KEY")'].join('\n'),
    );
    expect(valuesOf(node, 'environment')).toEqual(['DENO_KEY', 'GITHUB_TOKEN', 'OTHER_TOKEN']);

    const python = extract(
      'scripts/a.py',
      ['os.environ["ANTHROPIC_API_KEY"]', 'os.getenv("DATABASE_URL")', 'os.environ.get("EXTRA")'].join('\n'),
    );
    expect(valuesOf(python, 'environment')).toEqual(['ANTHROPIC_API_KEY', 'DATABASE_URL', 'EXTRA']);
  });

  it('finds shell references in both forms', () => {
    const findings = extract('scripts/a.sh', 'echo "$OPENAI_API_KEY" "${AWS_SECRET_ACCESS_KEY}"\n');
    expect(valuesOf(findings, 'environment')).toEqual(['AWS_SECRET_ACCESS_KEY', 'OPENAI_API_KEY']);
  });

  it('stores names only, never values', () => {
    const findings = extract('scripts/a.sh', 'export OPENAI_API_KEY="sk-not-a-real-secret-value"\n');
    const values = valuesOf(findings, 'environment');
    expect(values).not.toContain('sk-not-a-real-secret-value');
    for (const finding of findings) {
      expect(finding.evidence.snippet ?? '').not.toContain('sk-not-a-real');
    }
  });

  it('reports a computed variable name as dynamic', () => {
    const findings = extract('scripts/a.py', 'os.environ[variable_name]');
    expect(valuesOf(findings, 'environment')).toEqual(['<dynamic>']);
  });

  it('skips variables every process already has', () => {
    const findings = extract('scripts/a.sh', 'cd "$HOME" && echo "$PWD" && echo "$PATH"\n');
    expect(valuesOf(findings, 'environment')).toEqual([]);
  });

  it('ignores bare dollar references in prose', () => {
    const findings = extract('SKILL.md', 'This costs $USD per request.\n');
    expect(valuesOf(findings, 'environment')).toEqual([]);
  });

  it('reads braced references inside config files', () => {
    const findings = extract('config.yaml', 'token: ${EXAMPLE_API_TOKEN}\n');
    expect(valuesOf(findings, 'environment')).toEqual(['EXAMPLE_API_TOKEN']);
    expect(findingFor(findings, 'environment', 'EXAMPLE_API_TOKEN')?.confidence).toBe('medium');
  });
});
