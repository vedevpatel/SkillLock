import { environmentExtractor } from './environment.js';
import { filesystemExtractor } from './filesystem.js';
import { mcpExtractor } from './mcp.js';
import { networkExtractor } from './network.js';
import { shellExtractor } from './shell.js';
import { toolsExtractor } from './tools.js';
import type { Extractor } from './types.js';

/** Registration order is fixed; findings are sorted downstream, so it does not affect output. */
export const EXTRACTORS: readonly Extractor[] = [
  networkExtractor,
  filesystemExtractor,
  environmentExtractor,
  shellExtractor,
  toolsExtractor,
  mcpExtractor,
];

export {
  environmentExtractor,
  filesystemExtractor,
  mcpExtractor,
  networkExtractor,
  shellExtractor,
  toolsExtractor,
};
export type { Extractor, ExtractorOptions } from './types.js';
