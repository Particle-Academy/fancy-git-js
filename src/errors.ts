import type { GitErrorCode } from "./types.js";

/**
 * What `redactSecrets` removes: credentials by their SHAPE or their CONTEXT,
 * never simply the word after "token" or "password". That rule blanked
 * ordinary provider text ("Token scope insufficient" became
 * "[REDACTED] insufficient") while missing a bare `PRIVATE-TOKEN: …` header,
 * `Authorization: Basic …`, a `private_token=` query parameter, GitLab's
 * non-PAT tokens and GitHub fine-grained PATs entirely.
 *
 * Kept identical to `FancyGit\Error\GitException::redact()` in fancy-git-php;
 * both suites read the same `tests/fixtures/redaction-cases.json`.
 */
const SECRET_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  // Credential headers: keep the header name and auth scheme, drop the value.
  [/\b((?:proxy-)?authorization\s*:\s*(?:(?:bearer|basic|token)\s+)?)[^\s,;'"]+/gi, "$1[REDACTED]"],
  [/\b((?:private|job|deploy)-token\s*:\s*)[^\s,;'"]+/gi, "$1[REDACTED]"],
  // A credential in a query string or an assignment: private_token=, access_token=, password=, client_secret=.
  [/\b([\w-]*(?:token|password|passwd|secret)=)[^\s&#,;'"]+/gi, "$1[REDACTED]"],
  // Host-issued token shapes, wherever they appear.
  [/gh[pousr]_[A-Za-z0-9_]{20,}/g, "[REDACTED]"],
  [/github_pat_[A-Za-z0-9_]{20,}/g, "[REDACTED]"],
  [/gl(?:pat|oas|dt|rtr|rt|cbt|ptt|ft|imt|agent|wt|soat|ffct)-[A-Za-z0-9_-]{20,}/g, "[REDACTED]"],
  // A bearer value outside a header, when it looks like a credential rather than a word.
  [/\b(bearer\s+)(?=[A-Za-z0-9._~+/-]*\d)[A-Za-z0-9._~+/-]{16,}=*/gi, "$1[REDACTED]"],
  // Userinfo in a URL: https://user:secret@host.
  [/https?:\/\/[^/@\s]+@/g, "[REDACTED]"],
];

export function redactSecrets(value: string): string {
  return SECRET_PATTERNS.reduce(
    (safe, [pattern, replacement]) => safe.replace(pattern, replacement),
    value,
  );
}

export class GitError extends Error {
  constructor(
    public readonly code: GitErrorCode,
    message: string,
    public readonly exitCode?: number,
  ) {
    super(redactSecrets(message));
    this.name = "GitError";
  }
}

export function classifyGitError(message: string, exitCode?: number): GitError {
  const lower = message.toLowerCase();
  let code: GitErrorCode = "unknown";
  if (lower.includes("authentication") || lower.includes("permission denied")) code = "auth";
  else if (lower.includes("conflict") || lower.includes("unmerged")) code = "conflict";
  else if (lower.includes("local changes") || lower.includes("would be overwritten")) code = "dirty_worktree";
  else if (lower.includes("non-fast-forward") || lower.includes("fetch first")) code = "non_fast_forward";
  else if (lower.includes("not found") || lower.includes("unknown revision")) code = "not_found";
  return new GitError(code, message, exitCode);
}
