/**
 * SkillLock: a deterministic static authority-diff engine for Agent Skills.
 *
 * Given the same skill directory, `scanSkill` always produces the same
 * normalized authority manifest. When the directory changes, `diffAuthority`
 * shows exactly what authority was added or removed.
 */

export {
  diffAuthority,
  gatedEntries,
  informationalEntries,
  isExpansion,
  type AuthorityDiff,
  type DiffEntry,
  type GateOptions,
} from './diff/diff-authority.js';
export {
  renderDiff,
  renderInitSummary,
  renderInspect,
  renderNoDrift,
  sectionFor,
  verbFor,
} from './diff/render-diff.js';
export { confidenceFor } from './evidence/confidence.js';
export { isNegatedContext, makeFinding, positionOf } from './evidence/evidence.js';
export { EXTRACTORS } from './extractors/index.js';
export type { Extractor, ExtractorOptions } from './extractors/types.js';
export { buildAuthority, MAX_EVIDENCE_PER_ITEM } from './manifest/build.js';
export { aggregateHash, hashText } from './manifest/hash.js';
export {
  compareStrings,
  dedupe,
  isSensitiveEnvName,
  normalizeCommand,
  normalizeEnv,
  normalizeMcp,
  normalizePath,
  normalizeTool,
  normalizeUrl,
  sensitiveScope,
} from './manifest/normalize.js';
export {
  canonicalizeManifest,
  parseManifest,
  serializeManifest,
} from './manifest/serialize.js';
export {
  AUTHORITY_KINDS,
  DYNAMIC,
  SCHEMA_VERSION,
  SKILL_ROOT_PLACEHOLDER,
  authorityCount,
  authorityEntries,
  emptyAuthority,
  type AuthorityFinding,
  type AuthorityItem,
  type AuthorityKind,
  type AuthorityModel,
  type Confidence,
  type Evidence,
  type Language,
  type Manifest,
  type ScannedFile,
} from './manifest/schema.js';
export { classifyFile } from './scanner/classify-file.js';
export { collectFiles, normalizeText } from './scanner/collect-files.js';
export { LOCKFILE_NAME, SKILL_FILE, lockfilePath, scanSkill, type ScanResult } from './scanner/scan.js';
export { parseAllowedTools, parseSkillMarkdown } from './scanner/skill-md.js';
export { buildScanUnits, type ScanUnit, type UnitContext } from './scanner/units.js';
