import { hashText } from '../../src/manifest/hash.js';
import type { AuthorityFinding, AuthorityKind, Language } from '../../src/manifest/schema.js';
import { EXTRACTORS } from '../../src/extractors/index.js';
import { buildScanUnits } from '../../src/scanner/units.js';
import { classifyFile } from '../../src/scanner/classify-file.js';

/** Run every extractor over a synthetic file, the way `scanSkill` does. */
export function extract(path: string, content: string, root = '/skill'): AuthorityFinding[] {
  const language: Language = classifyFile(path);
  const file = { path, sha256: hashText(content), language, content };
  const findings: AuthorityFinding[] = [];
  for (const unit of buildScanUnits(file)) {
    for (const extractor of EXTRACTORS) {
      if (!extractor.supports(unit)) continue;
      findings.push(...extractor.extract(unit, { root }));
    }
  }
  return findings;
}

/** Sorted, deduplicated values of one authority kind. */
export function valuesOf(findings: readonly AuthorityFinding[], kind: AuthorityKind): string[] {
  return [...new Set(findings.filter((f) => f.kind === kind).map((f) => f.value))].sort();
}

export function findingFor(
  findings: readonly AuthorityFinding[],
  kind: AuthorityKind,
  value: string,
): AuthorityFinding | undefined {
  return findings.find((f) => f.kind === kind && f.value === value);
}
