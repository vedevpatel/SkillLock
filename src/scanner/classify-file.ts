import type { Language } from '../manifest/schema.js';

const BY_EXTENSION: Record<string, Language> = {
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.py': 'python',
  '.js': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.jsx': 'javascript',
  '.ts': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.tsx': 'typescript',
  '.sh': 'shell',
  '.bash': 'shell',
  '.zsh': 'shell',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.json': 'json',
};

/** Extension -> language. Content sniffing is deliberately avoided: it is one more thing to keep deterministic. */
export function classifyFile(path: string): Language {
  const lower = path.toLowerCase();
  const dot = lower.lastIndexOf('.');
  if (dot === -1) return 'other';
  return BY_EXTENSION[lower.slice(dot)] ?? 'other';
}

/** Languages whose literals are treated as executable code rather than prose. */
export function isExecutableLanguage(language: Language): boolean {
  return (
    language === 'python' ||
    language === 'javascript' ||
    language === 'typescript' ||
    language === 'shell'
  );
}

/** The one file Agent Skills are centered on. */
export function isSkillFile(path: string): boolean {
  return path === 'SKILL.md';
}

/** Documentation that ships alongside a skill: lower confidence by default. */
export function isReferenceDoc(path: string): boolean {
  if (isSkillFile(path)) return false;
  if (classifyFile(path) !== 'markdown') return false;
  return true;
}
