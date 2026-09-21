import type { AuthorityFinding } from '../manifest/schema.js';
import type { ScanUnit } from '../scanner/units.js';

/**
 * Regexes are one way to produce findings, not the thing SkillLock is built
 * around. Any future extractor — Python AST, tree-sitter, a runtime tracer —
 * implements this interface and emits the same `AuthorityFinding`.
 */
export interface Extractor {
  name: string;
  supports(unit: ScanUnit): boolean;
  extract(unit: ScanUnit): AuthorityFinding[];
}
