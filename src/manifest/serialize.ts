/**
 * Stable JSON. Key order is fixed by construction, map keys are sorted
 * byte-wise, and the file always ends with a newline, so that `skilllock init`
 * followed by `git diff` shows nothing unless authority or content changed.
 */

import { compareStrings } from './normalize.js';
import {
  SCHEMA_VERSION,
  type AuthorityItem,
  type AuthorityModel,
  type Evidence,
  type Manifest,
} from './schema.js';

/** Rebuild the manifest with every key in canonical order. */
export function canonicalizeManifest(manifest: Manifest): Manifest {
  return {
    schemaVersion: manifest.schemaVersion,
    skill: {
      name: manifest.skill.name,
      root: manifest.skill.root,
    },
    content: {
      hash: manifest.content.hash,
      files: sortRecord(manifest.content.files),
    },
    authority: canonicalizeAuthority(manifest.authority),
  };
}

export function canonicalizeAuthority(authority: AuthorityModel): AuthorityModel {
  return {
    network: authority.network.map(canonicalizeItem),
    filesystem: {
      read: authority.filesystem.read.map(canonicalizeItem),
      write: authority.filesystem.write.map(canonicalizeItem),
    },
    environment: authority.environment.map(canonicalizeItem),
    shell: authority.shell.map(canonicalizeItem),
    tools: authority.tools.map(canonicalizeItem),
    mcp: authority.mcp.map(canonicalizeItem),
  };
}

function canonicalizeItem(item: AuthorityItem): AuthorityItem {
  return {
    value: item.value,
    confidence: item.confidence,
    evidence: item.evidence.map(canonicalizeEvidence),
  };
}

function canonicalizeEvidence(evidence: Evidence): Evidence {
  const out: Evidence = {
    file: evidence.file,
    line: evidence.line,
    reason: evidence.reason,
  };
  if (evidence.snippet !== undefined && evidence.snippet !== '') out.snippet = evidence.snippet;
  return out;
}

function sortRecord(record: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(record).sort(compareStrings)) {
    out[key] = record[key]!;
  }
  return out;
}

/** Serialize a manifest to the exact bytes written to `skilllock.json`. */
export function serializeManifest(manifest: Manifest): string {
  return `${JSON.stringify(canonicalizeManifest(manifest), null, 2)}\n`;
}

export interface ParseResult {
  manifest: Manifest;
}

/** Parse and shape-check a lockfile. Throws a human-readable error on mismatch. */
export function parseManifest(text: string, source: string): Manifest {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new Error(`${source} is not valid JSON: ${(error as Error).message}`);
  }
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`${source} is not a SkillLock manifest.`);
  }
  const candidate = raw as Partial<Manifest>;
  if (typeof candidate.schemaVersion !== 'number') {
    throw new Error(`${source} is missing "schemaVersion".`);
  }
  if (candidate.schemaVersion > SCHEMA_VERSION) {
    throw new Error(
      `${source} uses schemaVersion ${candidate.schemaVersion}, but this SkillLock understands up to ${SCHEMA_VERSION}. Upgrade skilllock.`,
    );
  }
  if (!candidate.authority || typeof candidate.authority !== 'object') {
    throw new Error(`${source} is missing "authority".`);
  }
  const authority = candidate.authority as Partial<AuthorityModel>;
  const filesystem = authority.filesystem ?? { read: [], write: [] };
  const manifest: Manifest = {
    schemaVersion: candidate.schemaVersion,
    skill: {
      name: candidate.skill?.name ?? '',
      root: candidate.skill?.root ?? '$SKILL',
    },
    content: {
      hash: candidate.content?.hash ?? '',
      files: candidate.content?.files ?? {},
    },
    authority: {
      network: asItems(authority.network),
      filesystem: {
        read: asItems(filesystem.read),
        write: asItems(filesystem.write),
      },
      environment: asItems(authority.environment),
      shell: asItems(authority.shell),
      tools: asItems(authority.tools),
      mcp: asItems(authority.mcp),
    },
  };
  return manifest;
}

function asItems(value: unknown): AuthorityItem[] {
  if (!Array.isArray(value)) return [];
  const out: AuthorityItem[] = [];
  for (const entry of value) {
    if (typeof entry === 'string') {
      out.push({ value: entry, confidence: 'unknown', evidence: [] });
      continue;
    }
    if (typeof entry !== 'object' || entry === null) continue;
    const item = entry as Partial<AuthorityItem>;
    if (typeof item.value !== 'string') continue;
    out.push({
      value: item.value,
      confidence: item.confidence ?? 'unknown',
      evidence: Array.isArray(item.evidence) ? item.evidence : [],
    });
  }
  return out;
}
