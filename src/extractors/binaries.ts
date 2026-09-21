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
 * True when a line plausibly starts with a command invocation. Applied only to
 * loose contexts (unlabelled fences, inline code) where a false positive would
 * be embarrassing and a false negative is acceptable.
 */
export function looksLikeCommandLine(line: string): boolean {
  const trimmed = line.trim().replace(/^\$\s+/, '');
  if (!trimmed) return false;
  const first = /^([A-Za-z0-9._/-]+)/.exec(trimmed)?.[1] ?? '';
  if (!first) return false;
  const base = (first.split('/').pop() ?? first).toLowerCase();
  return KNOWN_BINARIES.has(base);
}
