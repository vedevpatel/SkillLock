/**
 * Binaries SkillLock recognizes by name. Used to decide whether a line inside an
 * unlabelled code fence or an inline code span is a command at all — the
 * conservative alternative to treating every backticked word as a program.
 */
export const KNOWN_BINARIES: ReadonlySet<string> = new Set([
  'ab', 'ansible', 'ant', 'apt', 'apt-get', 'aria2c', 'aws', 'awk', 'az',
  'base64', 'bash', 'bazel', 'bc', 'brew', 'bun', 'bundle', 'bzip2',
  'cargo', 'cat', 'chmod', 'chown', 'clang', 'cmake', 'code', 'composer', 'convert', 'cp', 'crontab', 'curl', 'cut', 'cypress',
  'dd', 'deno', 'df', 'diff', 'dig', 'dnf', 'docker', 'docker-compose', 'dotnet', 'du',
  'emacs', 'eslint', 'expect', 'ffmpeg', 'fd', 'file', 'find', 'flake8', 'fzf',
  'gcc', 'gcloud', 'gem', 'gh', 'git', 'git-lfs', 'go', 'gpg', 'gradle', 'grep', 'gunzip', 'gzip',
  'head', 'helm', 'hostname', 'htop', 'http', 'httpie', 'hugo',
  'id', 'ifconfig', 'install', 'ip', 'java', 'javac', 'jest', 'jq',
  'kill', 'killall', 'kubectl', 'launchctl', 'less', 'ln', 'ls', 'lsof',
  'make', 'md5', 'md5sum', 'mkdir', 'mktemp', 'mongo', 'more', 'mv', 'mvn', 'mypy', 'mysql',
  'nano', 'nc', 'ncat', 'netcat', 'netstat', 'nice', 'nmap', 'node', 'nohup', 'npm', 'npx', 'nslookup',
  'od', 'open', 'openssl', 'osascript', 'pandoc', 'patch', 'pbcopy', 'pbpaste', 'perl', 'php',
  'pacman', 'ping', 'pip', 'pip3', 'pipx', 'playwright', 'plutil', 'pnpm', 'poetry', 'pre-commit',
  'prettier', 'ps', 'psql', 'pytest', 'python', 'python2', 'python3',
  'redis-cli', 'rg', 'rm', 'rmdir', 'rsync', 'ruby', 'ruff', 'rustc',
  'say', 'scp', 'security', 'sed', 'sftp', 'sh', 'sha1sum', 'sha256sum', 'shasum', 'snap', 'sort', 'sqlite3',
  'ssh', 'ssh-add', 'ssh-keygen', 'stat', 'strings', 'strip', 'su', 'sudo', 'systemctl',
  'tail', 'tar', 'tee', 'telnet', 'terraform', 'tmux', 'top', 'touch', 'tr', 'traceroute', 'tsc', 'tox',
  'umount', 'uname', 'uniq', 'unzip', 'uv', 'uvx', 'vim', 'vitest',
  'wc', 'wget', 'whereis', 'which', 'whoami', 'xargs', 'xxd', 'xz', 'yarn', 'yq', 'yum',
  'zip', 'zsh',
]);

/**
 * Words that mark a line as English prose rather than a command line. Without
 * this, any documentation sentence beginning with a word that happens to be a
 * binary ("Say how many runs the panel took", "file … so it is the one git
 * call") is read as an invocation.
 */
const PROSE_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'be', 'been', 'but', 'by', 'can', 'do', 'does',
  'each', 'either', 'for', 'from', 'has', 'have', 'how', 'if', 'in', 'into',
  'is', 'it', 'its', 'not', 'of', 'on', 'or', 'our', 'should', 'so', 'than',
  'that', 'the', 'their', 'them', 'then', 'these', 'they', 'this', 'those',
  'to', 'was', 'we', 'were', 'what', 'when', 'which', 'why', 'will', 'with',
  'would', 'you', 'your',
]);

/** A command line in documentation is short; a sentence is not. */
const MAX_LOOSE_TOKENS = 8;

/**
 * True when a line plausibly *is* a command invocation. Applied only to loose
 * contexts (unlabelled fences, inline code) where a false positive would be
 * embarrassing and a false negative is acceptable.
 *
 * The binary must match by exact case: `git status` is a command, `GIT -C ...`
 * and `HEAD` are documentation conventions for something else.
 */
export function looksLikeCommandLine(line: string): boolean {
  const trimmed = line.trim().replace(/^\$\s+/, '');
  if (!trimmed) return false;
  if (/[.:?!,;]$/.test(trimmed) && !/[./][A-Za-z0-9_-]+$/.test(trimmed)) return false;

  const tokens = trimmed.split(/\s+/).filter(Boolean);
  // A bare binary name in backticks is usually a noun: a `patch` record, an `id`
  // column, a `bash` script. With no arguments it also says nothing about what
  // the command would touch.
  if (tokens.length < 2 || tokens.length > MAX_LOOSE_TOKENS) return false;

  const first = /^([A-Za-z0-9._/-]+)/.exec(tokens[0] ?? '')?.[1] ?? '';
  if (!first) return false;
  const base = first.split('/').pop() ?? first;
  if (!KNOWN_BINARIES.has(base)) return false;

  return !tokens.some((token) => PROSE_WORDS.has(token.toLowerCase()));
}
