import { describe, expect, it } from 'vitest';

import { extract, findingFor, valuesOf } from './helpers.js';

describe('filesystem extractor', () => {
  it('separates reads from writes', () => {
    const findings = extract(
      'scripts/a.py',
      ['open("./config.json")', 'open("./out/report.json", "w")'].join('\n'),
    );
    expect(valuesOf(findings, 'filesystem.read')).toEqual(['./config.json']);
    expect(valuesOf(findings, 'filesystem.write')).toEqual(['./out/report.json']);
  });

  it('resolves pathlib expressions', () => {
    const findings = extract('scripts/a.py', 'key = open(Path.home() / ".ssh/id_rsa").read()');
    expect(valuesOf(findings, 'filesystem.read')).toEqual(['~/.ssh/id_rsa']);
    expect(findingFor(findings, 'filesystem.read', '~/.ssh/id_rsa')?.confidence).toBe('high');
  });

  it('resolves os.path.join and expanduser', () => {
    const findings = extract(
      'scripts/a.py',
      [
        'open(os.path.join(os.path.expanduser("~"), ".aws", "credentials"))',
        'Path(os.environ["HOME"]) / ".kube/config"',
      ].join('\n'),
    );
    expect(valuesOf(findings, 'filesystem.read')).toContain('~/.aws/credentials');
  });

  it('resolves Node paths and flags', () => {
    const findings = extract(
      'scripts/a.js',
      [
        'fs.readFileSync("./config.json", "utf8");',
        'fs.writeFileSync("./out/report.json", data);',
        'fs.promises.appendFile("./out/log.txt", line);',
        'fs.copyFileSync("./a.txt", "./b.txt");',
        'path.join(os.homedir(), ".ssh", "id_rsa");',
      ].join('\n'),
    );
    expect(valuesOf(findings, 'filesystem.read')).toEqual(['./a.txt', './config.json']);
    expect(valuesOf(findings, 'filesystem.write')).toEqual([
      './b.txt',
      './out/log.txt',
      './out/report.json',
    ]);
  });

  it('records a directory-creating call as a scope', () => {
    const findings = extract('scripts/a.py', 'os.makedirs("./cache", exist_ok=True)');
    expect(valuesOf(findings, 'filesystem.write')).toEqual(['./cache/**']);
  });

  it('treats open with a read-write mode as both', () => {
    const findings = extract('scripts/a.py', 'open("./db.json", "r+")');
    expect(valuesOf(findings, 'filesystem.read')).toEqual(['./db.json']);
    expect(valuesOf(findings, 'filesystem.write')).toEqual(['./db.json']);
  });

  it('reports a computed path as dynamic', () => {
    const findings = extract(
      'scripts/a.py',
      ['path = get_sensitive_path()', 'open(path)'].join('\n'),
    );
    expect(valuesOf(findings, 'filesystem.read')).toEqual(['<dynamic>']);
    expect(findingFor(findings, 'filesystem.read', '<dynamic>')?.confidence).toBe('unknown');
  });

  it('does not report a write for every handle method on an open file', () => {
    const findings = extract(
      'scripts/a.py',
      ['with open("./out.json", "w") as handle:', '    handle.write("{}")'].join('\n'),
    );
    expect(valuesOf(findings, 'filesystem.write')).toEqual(['./out.json']);
  });

  it('records shell redirections and file arguments', () => {
    const findings = extract(
      'scripts/a.sh',
      [
        'cat ~/.ssh/id_rsa',
        'echo hello > ./out/report.txt',
        'echo more >> ./out/report.txt',
        'rm -rf ./cache/foo',
        'cp ./secret ./output',
        'mkdir -p ./out',
        'curl https://x.example/y > /dev/null',
      ].join('\n'),
    );
    expect(valuesOf(findings, 'filesystem.read')).toEqual(['./secret', '~/.ssh/id_rsa']);
    expect(valuesOf(findings, 'filesystem.write')).toEqual([
      './cache/foo',
      './out/**',
      './out/report.txt',
      './output',
    ]);
  });

  it('records a sensitive path mentioned in prose without a call site', () => {
    const findings = extract('SKILL.md', 'This skill reads your `~/.aws/credentials` file.\n');
    expect(valuesOf(findings, 'filesystem.read')).toEqual(['~/.aws/credentials']);
    expect(findingFor(findings, 'filesystem.read', '~/.aws/credentials')?.confidence).toBe('medium');
  });

  it('does not record ordinary paths mentioned in prose', () => {
    const findings = extract('SKILL.md', 'Look at `./some/notes.txt` for details.\n');
    expect(valuesOf(findings, 'filesystem.read')).toEqual([]);
  });

  it('strips the scanning host out of absolute paths', () => {
    const findings = extract('scripts/a.py', 'open("/skill/cache/x.json")', '/skill');
    expect(valuesOf(findings, 'filesystem.read')).toEqual(['$SKILL/cache/x.json']);
  });
});
