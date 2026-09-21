/**
 * Environment variable *names*. Never values: a lockfile that leaked secrets
 * would be worse than no lockfile at all.
 */

import { confidenceFor } from '../evidence/confidence.js';
import { isNegatedContext, makeFinding } from '../evidence/evidence.js';
import { normalizeEnv } from '../manifest/normalize.js';
import { DYNAMIC, type AuthorityFinding } from '../manifest/schema.js';
import type { ScanUnit } from '../scanner/units.js';
import type { Extractor } from './types.js';

/** `process.env.X`, `process.env["X"]`, `process.env[key]` */
const NODE_ENV =
  /process\s*\.\s*env\s*(?:\?\s*\.\s*|\.\s*)([A-Za-z_$][A-Za-z0-9_$]*)|process\s*\.\s*env\s*\[\s*(?:(['"`])([^'"`\n]+)\2|([^\]\n]+?))\s*\]/g;

/** `Deno.env.get("X")` */
const DENO_ENV = /Deno\s*\.\s*env\s*\.\s*get\s*\(\s*(?:(['"])([^'"\n]+)\1|([^)\n]+?))\s*\)/g;

/** `os.environ["X"]`, `os.environ.get("X")`, `os.getenv("X")` */
const PYTHON_ENV =
  /\b(?:os\s*\.\s*)?environ\s*\[\s*(?:(['"])([^'"\n]+)\1|([^\]\n]+?))\s*\]|\b(?:os\s*\.\s*)?(?:environ\s*\.\s*get|getenv)\s*\(\s*(?:(['"])([^'"\n]+)\4|([^,)\n]+?))\s*[,)]/g;

/** `${NAME}` and `${NAME:-default}` — valid in shell, YAML and JSON templates. */
const BRACED_VAR = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::?[-=+?][^}]*)?\}/g;

/** Bare `$NAME`, only trusted in shell-ish contexts. */
const BARE_VAR = /\$([A-Za-z_][A-Za-z0-9_]{1,})\b/g;

export const environmentExtractor: Extractor = {
  name: 'environment',
  supports: () => true,
  extract(unit) {
    const findings: AuthorityFinding[] = [];

    const push = (name: string | null, index: number, reason: string, dynamic = false): void => {
      const value = dynamic ? DYNAMIC : normalizeEnv(name ?? '');
      if (!value) return;
      findings.push(
        makeFinding({
          unit,
          kind: 'environment',
          value,
          confidence: confidenceFor(unit, {
            dynamic,
            negated: isNegatedContext(unit, index),
          }),
          reason,
          index,
        }),
      );
    };

    for (const match of unit.text.matchAll(NODE_ENV)) {
      const index = match.index ?? 0;
      const name = match[1] ?? match[3];
      if (name) push(name, index, 'process-env');
      else if (match[4]) push(null, index, 'dynamic-process-env', true);
    }

    for (const match of unit.text.matchAll(DENO_ENV)) {
      const index = match.index ?? 0;
      if (match[2]) push(match[2], index, 'deno-env');
      else if (match[3]) push(null, index, 'dynamic-deno-env', true);
    }

    for (const match of unit.text.matchAll(PYTHON_ENV)) {
      const index = match.index ?? 0;
      const name = match[2] ?? match[5];
      const dynamicExpression = match[3] ?? match[6];
      if (name) push(name, index, 'os-environ');
      else if (dynamicExpression) push(null, index, 'dynamic-os-environ', true);
    }

    for (const match of unit.text.matchAll(BRACED_VAR)) {
      push(match[1] ?? '', match.index ?? 0, 'shell-var');
    }

    if (allowsBareVariables(unit)) {
      for (const match of unit.text.matchAll(BARE_VAR)) {
        push(match[1] ?? '', match.index ?? 0, 'shell-var');
      }
    }

    return findings;
  },
};

/**
 * `$FOO` is a variable in shell and YAML. In Markdown prose it is more likely to
 * be money or a placeholder, so bare references there are skipped.
 */
function allowsBareVariables(unit: ScanUnit): boolean {
  if (unit.context === 'md-prose') return false;
  return (
    unit.language === 'shell' ||
    unit.language === 'yaml' ||
    unit.context === 'md-inline' ||
    unit.context === 'md-code' ||
    unit.context === 'frontmatter'
  );
}
