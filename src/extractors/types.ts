import type { AuthorityFinding } from '../manifest/schema.js';
import type { ScanUnit } from '../scanner/units.js';

export interface ExtractorOptions {
  /**
   * Absolute skill root, used to rewrite paths inside the skill to `$SKILL/...`
   * so the manifest never records where the skill was checked out.
   */
  root?: string;
}

/**
 * Regexes are one way to produce findings, not the thing SkillLock is built
 * around. Any future extractor — Python AST, tree-sitter, a runtime tracer —
 * implements this interface and emits the same `AuthorityFinding`.
 *
 * An extractor owns a *syntax*, not an authority kind: the shell extractor
 * reports the filesystem authority it finds in command lines, because that is
 * where the parsing lives.
 */
export interface Extractor {
  name: string;
  supports(unit: ScanUnit): boolean;
  extract(unit: ScanUnit, options?: ExtractorOptions): AuthorityFinding[];
}
