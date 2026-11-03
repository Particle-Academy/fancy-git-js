import { accessSync, constants, statSync } from "node:fs";
import { GitError } from "./errors.js";

/**
 * Which file a bare program name runs must not depend on the working directory.
 * On Windows the OS and the C runtime search the current directory (and, for a
 * spawn with `cwd`, that directory) ahead of PATH, so a repository could supply
 * its own "git". This walks PATH itself, absolute entries only, and the caller
 * spawns the absolute path it returns.
 *
 * Kept identical to `FancyGit\Process\ExecutableResolver` in fancy-git-php and
 * `findExecutable` in change-council; all three read the same
 * `executable-lookup-cases.json`.
 */

/** What CreateProcess can start without a shell. */
const RUNNABLE_EXTENSIONS = new Set([".com", ".exe"]);
/** cmd.exe re-parses a batch file's arguments, so one is never started for an untrusted ref. */
const BATCH_EXTENSIONS = new Set([".bat", ".cmd"]);
const DEFAULT_PATHEXT = ".COM;.EXE;.BAT;.CMD";

export interface ExecutableLookup {
  platform?: NodeJS.Platform;
  env?: Record<string, string | undefined>;
  isFile?: (path: string) => boolean;
}

export interface ExecutableMatch {
  /** The file to run, or null if PATH holds no runnable match. */
  path: string | null;
  /** The first batch file seen under this name, which is never returned as `path`. */
  batch: string | null;
}

export function isAbsoluteEntry(entry: string, platform: NodeJS.Platform): boolean {
  if (platform !== "win32") return entry.startsWith("/");
  // Not path.win32.isAbsolute: it accepts "\foo", which is relative to the
  // current drive and so still depends on the working directory.
  return /^[A-Za-z]:[\\/]/.test(entry) || /^[\\/]{2}[^\\/]+[\\/][^\\/]+/.test(entry);
}

function readEnv(
  env: Record<string, string | undefined>,
  key: string,
  platform: NodeJS.Platform,
): string | undefined {
  if (platform !== "win32") return env[key];
  for (const [name, value] of Object.entries(env)) {
    if (name.toUpperCase() === key) return value;
  }
  return undefined;
}

function isRunnableFile(path: string, platform: NodeJS.Platform): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    if (platform !== "win32") accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function findExecutable(name: string, lookup: ExecutableLookup = {}): ExecutableMatch {
  const platform = lookup.platform ?? process.platform;
  const env = lookup.env ?? process.env;
  const isFile = lookup.isFile ?? ((path: string) => isRunnableFile(path, platform));
  const windows = platform === "win32";
  const separator = windows ? "\\" : "/";

  const hasExtension = /\.(?:com|exe|bat|cmd)$/i.test(name);
  const extensions = !windows || hasExtension
    ? [""]
    : (readEnv(env, "PATHEXT", platform) || DEFAULT_PATHEXT).split(";").filter(Boolean);

  let batch: string | null = null;
  for (const raw of (readEnv(env, "PATH", platform) ?? "").split(windows ? ";" : ":")) {
    const entry = windows ? raw.replace(/^"(.*)"$/, "$1") : raw;
    if (!isAbsoluteEntry(entry, platform)) continue;
    const directory = entry.replace(windows ? /[\\/]+$/ : /\/+$/, "");
    for (const extension of extensions) {
      const candidate = `${directory}${separator}${name}${extension}`;
      if (!isFile(candidate)) continue;
      if (!windows) return { path: candidate, batch };
      const kind = /\.[^.\\/]*$/.exec(candidate)?.[0].toLowerCase() ?? "";
      if (RUNNABLE_EXTENSIONS.has(kind)) return { path: candidate, batch };
      if (BATCH_EXTENSIONS.has(kind)) batch ??= candidate;
    }
  }
  return { path: null, batch };
}

const resolved = new Map<string, string>();

/**
 * The absolute path to spawn for `name`, cached for the life of the process. An
 * absolute `name` is returned as given, which is how a host names its own git.
 * A failure is not cached, so fixing PATH recovers without a restart.
 */
export function resolveExecutable(name: string): string {
  const platform = process.platform;
  if (isAbsoluteEntry(name, platform)) return name;
  if (/[\\/]/.test(name)) {
    throw new GitError("invalid_argument", `Refusing to run "${name}": give a bare name or an absolute path.`);
  }

  const cached = resolved.get(name);
  if (cached !== undefined) return cached;

  const { path, batch } = findExecutable(name);
  if (path !== null) {
    resolved.set(name, path);
    return path;
  }
  if (batch !== null) {
    throw new GitError(
      "not_found",
      `Found "${batch}" on PATH, but a batch file cannot be run without a shell. Add a real ${name} executable to PATH, or pass a ProcessRunner that calls your own copy.`,
    );
  }
  throw new GitError(
    "not_found",
    `Could not find the "${name}" executable. Only absolute PATH entries are searched; the current directory is never used. Add ${name} to PATH, or pass a ProcessRunner that calls your own copy.`,
  );
}
