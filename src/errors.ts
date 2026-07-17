import type { GitErrorCode } from "./types.js";

const SECRET_PATTERNS = [
  /(?:gh[pousr]_[A-Za-z0-9_]{20,})/g,
  /(?:glpat-[A-Za-z0-9_-]{20,})/g,
  /(?:Bearer|token|password)\s+[^\s]+/gi,
  /https?:\/\/[^/@\s]+@/g,
];

export function redactSecrets(value: string): string {
  return SECRET_PATTERNS.reduce(
    (safe, pattern) => safe.replace(pattern, "[REDACTED]"),
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
