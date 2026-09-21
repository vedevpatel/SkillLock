/**
 * The stable schema. Everything else in SkillLock is an implementation detail
 * that produces this shape.
 *
 * SkillLock means: "this artifact statically references this resource."
 * It does not mean the resource can be accessed, will be accessed, or that the
 * skill is safe.
 */

export const SCHEMA_VERSION = 1;

/** Placeholder written into the manifest instead of a machine-specific path. */
export const SKILL_ROOT_PLACEHOLDER = '$SKILL';

/** Value used when a resource is computed at runtime and cannot be resolved statically. */
export const DYNAMIC = '<dynamic>';

export type Language =
  | 'markdown'
  | 'python'
  | 'javascript'
  | 'typescript'
  | 'shell'
  | 'yaml'
  | 'json'
  | 'other';

export type Confidence = 'high' | 'medium' | 'low' | 'unknown';

export type AuthorityKind =
  | 'network'
  | 'filesystem.read'
  | 'filesystem.write'
  | 'environment'
  | 'shell'
  | 'tool'
  | 'mcp';

export const AUTHORITY_KINDS: readonly AuthorityKind[] = [
  'network',
  'filesystem.read',
  'filesystem.write',
  'environment',
  'shell',
  'tool',
  'mcp',
];

/**
 * Where a piece of authority came from. Every authority item carries evidence
 * pointing back at the file and line that produced it.
 */
export interface Evidence {
  /** Skill-relative, POSIX-separated path. */
  file: string;
  /** 1-based line number. */
  line: number;
  /** Machine-readable reason label, e.g. `literal-fetch-url`. */
  reason: string;
  /** Normalized, length-capped source excerpt. */
  snippet?: string;
}

/** What an extractor emits. One match, one finding. */
export interface AuthorityFinding {
  kind: AuthorityKind;
  value: string;
  confidence: Confidence;
  evidence: Evidence & { column?: number };
}

/** An aggregated, normalized, deduplicated piece of authority. */
export interface AuthorityItem {
  value: string;
  confidence: Confidence;
  evidence: Evidence[];
}

export interface AuthorityModel {
  network: AuthorityItem[];
  filesystem: {
    read: AuthorityItem[];
    write: AuthorityItem[];
  };
  environment: AuthorityItem[];
  shell: AuthorityItem[];
  tools: AuthorityItem[];
  mcp: AuthorityItem[];
}

export interface Manifest {
  schemaVersion: number;
  skill: {
    name: string;
    root: string;
  };
  content: {
    /** `sha256:<hex>` over the sorted per-file hashes. */
    hash: string;
    /** Skill-relative path -> `sha256:<hex>`. Sorted by path. */
    files: Record<string, string>;
  };
  authority: AuthorityModel;
}

/** A collected, hashed, text-normalized file. */
export interface ScannedFile {
  /** Skill-relative, POSIX-separated path. */
  path: string;
  /** `sha256:<hex>` of the newline-normalized content. */
  sha256: string;
  language: Language;
  content: string;
}

export const CONFIDENCE_RANK: Record<Confidence, number> = {
  high: 3,
  medium: 2,
  low: 1,
  unknown: 0,
};

/** Highest confidence wins when the same value is found several ways. */
export function maxConfidence(a: Confidence, b: Confidence): Confidence {
  return CONFIDENCE_RANK[a] >= CONFIDENCE_RANK[b] ? a : b;
}

export function emptyAuthority(): AuthorityModel {
  return {
    network: [],
    filesystem: { read: [], write: [] },
    environment: [],
    shell: [],
    tools: [],
    mcp: [],
  };
}

/** Flatten the authority model into `(kind, item)` pairs in canonical order. */
export function authorityEntries(
  model: AuthorityModel,
): Array<{ kind: AuthorityKind; item: AuthorityItem }> {
  const out: Array<{ kind: AuthorityKind; item: AuthorityItem }> = [];
  const push = (kind: AuthorityKind, items: AuthorityItem[]) => {
    for (const item of items) out.push({ kind, item });
  };
  push('network', model.network);
  push('filesystem.read', model.filesystem.read);
  push('filesystem.write', model.filesystem.write);
  push('environment', model.environment);
  push('shell', model.shell);
  push('tool', model.tools);
  push('mcp', model.mcp);
  return out;
}

export function authorityCount(model: AuthorityModel): number {
  return authorityEntries(model).length;
}

/** The list inside `model` that holds items of `kind`. */
export function bucketFor(model: AuthorityModel, kind: AuthorityKind): AuthorityItem[] {
  switch (kind) {
    case 'network':
      return model.network;
    case 'filesystem.read':
      return model.filesystem.read;
    case 'filesystem.write':
      return model.filesystem.write;
    case 'environment':
      return model.environment;
    case 'shell':
      return model.shell;
    case 'tool':
      return model.tools;
    case 'mcp':
      return model.mcp;
  }
}
