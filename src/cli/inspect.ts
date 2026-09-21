import { renderInspect } from '../diff/render-diff.js';
import { CONFIDENCE_RANK, type AuthorityModel, type Confidence } from '../manifest/schema.js';
import { serializeManifest } from '../manifest/serialize.js';
import { scanSkill } from '../scanner/scan.js';
import { CliError, EXIT_OK, resolveSkillDirectory, writeOut } from './common.js';

export interface InspectOptions {
  directory: string;
  json?: boolean;
  minConfidence?: string;
}

const CONFIDENCE_LEVELS: readonly Confidence[] = ['high', 'medium', 'low', 'unknown'];

/** Explain the skill's current authority, with the evidence for each item. */
export function runInspect(options: InspectOptions): number {
  const root = resolveSkillDirectory(options.directory);
  const result = scanSkill({ directory: root });

  const minConfidence = parseConfidence(options.minConfidence);
  const authority = minConfidence
    ? filterByConfidence(result.manifest.authority, minConfidence)
    : result.manifest.authority;

  if (options.json) {
    writeOut(serializeManifest({ ...result.manifest, authority }).trimEnd());
    return EXIT_OK;
  }

  writeOut(renderInspect(result.manifest.skill.name, authority));
  return EXIT_OK;
}

function parseConfidence(value: string | undefined): Confidence | null {
  if (!value) return null;
  const candidate = value.toLowerCase() as Confidence;
  if (!CONFIDENCE_LEVELS.includes(candidate)) {
    throw new CliError(
      `Unknown confidence level: ${value}`,
      `Expected one of: ${CONFIDENCE_LEVELS.join(', ')}`,
    );
  }
  return candidate;
}

/** `unknown` (runtime-computed) is always kept: hiding it would hide real drift. */
function filterByConfidence(authority: AuthorityModel, minimum: Confidence): AuthorityModel {
  const keep = (confidence: Confidence): boolean =>
    confidence === 'unknown' || CONFIDENCE_RANK[confidence] >= CONFIDENCE_RANK[minimum];
  return {
    network: authority.network.filter((item) => keep(item.confidence)),
    filesystem: {
      read: authority.filesystem.read.filter((item) => keep(item.confidence)),
      write: authority.filesystem.write.filter((item) => keep(item.confidence)),
    },
    environment: authority.environment.filter((item) => keep(item.confidence)),
    shell: authority.shell.filter((item) => keep(item.confidence)),
    tools: authority.tools.filter((item) => keep(item.confidence)),
    mcp: authority.mcp.filter((item) => keep(item.confidence)),
  };
}
