import { resolve } from "node:path";
import type {
  Branch,
  CommandOptions,
  Commit,
  Diff,
  DiffQuery,
  FileChange,
  LogQuery,
  MutationOptions,
  OperationProposal,
  RepositoryInfo,
  WorkingTreeStatus,
} from "./types.js";
import { NodeProcessRunner, type ProcessRunner } from "./process.js";

const FIELD = "\x1f";
const RECORD = "\x1e";

const changeKind: Record<string, FileChange["index"]> = {
  ".": null,
  "A": "added",
  "M": "modified",
  "D": "deleted",
  "R": "renamed",
  "C": "copied",
  "U": "conflicted",
  "?": "untracked",
};

function parseChange(code: string): FileChange["index"] {
  return Object.prototype.hasOwnProperty.call(changeKind, code)
    ? changeKind[code]!
    : "conflicted";
}

export class GitRepository {
  readonly directory: string;

  constructor(directory: string, private readonly runner: ProcessRunner = new NodeProcessRunner()) {
    this.directory = resolve(directory);
  }

  private async git(args: string[], options?: CommandOptions): Promise<string> {
    const result = await this.runner.run("git", ["-C", this.directory, "--no-pager", ...args], options);
    return result.stdout;
  }

  async info(options?: CommandOptions): Promise<RepositoryInfo> {
    const root = (await this.git(["rev-parse", "--show-toplevel"], options)).trim();
    const bare = (await this.git(["rev-parse", "--is-bare-repository"], options)).trim() === "true";
    const branch = (await this.git(["branch", "--show-current"], options)).trim() || null;
    let head: string | null = null;
    try {
      head = (await this.git(["rev-parse", "HEAD"], options)).trim();
    } catch {
      // An initialized repository may have no commits yet.
    }
    return { root, bare, branch, head };
  }

  async status(options?: CommandOptions): Promise<WorkingTreeStatus> {
    const output = await this.git(["status", "--porcelain=v2", "--branch", "-z"], options);
    const records = output.split("\0").filter(Boolean);
    let branch: string | null = null;
    let upstream: string | null = null;
    let ahead = 0;
    let behind = 0;
    const files: FileChange[] = [];
    for (let i = 0; i < records.length; i += 1) {
      const record = records[i]!;
      if (record.startsWith("# branch.head ")) branch = record.slice(14) === "(detached)" ? null : record.slice(14);
      else if (record.startsWith("# branch.upstream ")) upstream = record.slice(18);
      else if (record.startsWith("# branch.ab ")) {
        const match = record.match(/\+(\d+) -(\d+)/);
        ahead = Number(match?.[1] ?? 0);
        behind = Number(match?.[2] ?? 0);
      } else if (record.startsWith("? ")) {
        files.push({ path: record.slice(2), index: null, worktree: "untracked" });
      } else if (record.startsWith("1 ") || record.startsWith("2 ")) {
        const parts = record.split(" ");
        const xy = parts[1]!;
        const path = parts.slice(record.startsWith("2 ") ? 9 : 8).join(" ");
        const file: FileChange = {
          path,
          index: parseChange(xy[0]!),
          worktree: parseChange(xy[1]!),
        };
        if (record.startsWith("2 ") && records[i + 1]) file.previousPath = records[++i];
        files.push(file);
      } else if (record.startsWith("u ")) {
        files.push({ path: record.split(" ").slice(10).join(" "), index: "conflicted", worktree: "conflicted" });
      }
    }
    return { branch, upstream, ahead, behind, files, clean: files.length === 0 };
  }

  async log(query: LogQuery = {}): Promise<Commit[]> {
    const format = [`%H`, `%h`, `%P`, `%an`, `%ae`, `%aI`, `%s`].join(FIELD) + RECORD;
    const args = ["log", `--format=${format}`, `--max-count=${query.limit ?? 50}`, `--skip=${query.skip ?? 0}`];
    if (query.ref) args.push(query.ref);
    const output = await this.git(args, query);
    return output.split(RECORD).filter((row) => row.trim()).map((row) => {
      const [id, shortId, parents, authorName, authorEmail, authoredAt, subject] = row.trim().split(FIELD);
      return {
        id: id!,
        shortId: shortId!,
        parents: parents ? parents.split(" ") : [],
        authorName: authorName!,
        authorEmail: authorEmail!,
        authoredAt: authoredAt!,
        subject: subject!,
      };
    });
  }

  async diff(query: DiffQuery = {}): Promise<Diff> {
    const args = ["diff", "--no-ext-diff", "--binary"];
    if (query.staged) args.push("--cached");
    if (query.from) args.push(query.from);
    if (query.to) args.push(query.to);
    if (query.paths?.length) args.push("--", ...query.paths);
    const patch = await this.git(args, query);
    const files = [...patch.matchAll(/^diff --git a\/(.+?) b\/(.+)$/gm)].map((match) => match[2]!);
    return { patch, files };
  }

  async branches(options?: CommandOptions): Promise<Branch[]> {
    const format = ["%(refname:short)", "%(HEAD)", "%(objectname)", "%(upstream:short)", "%(refname)"].join(FIELD) + RECORD;
    const output = await this.git(["for-each-ref", `--format=${format}`, "refs/heads", "refs/remotes"], options);
    return output.split(RECORD).filter((row) => row.trim()).map((row) => {
      const [name, head, target, upstream, refname] = row.trim().split(FIELD);
      return { name: name!, current: head === "*", remote: refname!.startsWith("refs/remotes/"), target: target!, upstream: upstream || undefined };
    });
  }

  async stage(paths: string[], options: MutationOptions = {}): Promise<void | OperationProposal> {
    if (options.pendingMode === "propose") return { operation: "stage", arguments: { paths }, summary: `Stage ${paths.length} path(s)` };
    await this.git(["add", "--", ...paths], options);
  }

  async unstage(paths: string[], options: MutationOptions = {}): Promise<void | OperationProposal> {
    if (options.pendingMode === "propose") return { operation: "unstage", arguments: { paths }, summary: `Unstage ${paths.length} path(s)` };
    await this.git(["restore", "--staged", "--", ...paths], options);
  }

  async commit(message: string, options: MutationOptions = {}): Promise<Commit | OperationProposal> {
    if (options.pendingMode === "propose") return { operation: "commit", arguments: { message }, summary: `Commit staged changes: ${message}` };
    await this.git(["commit", "--message", message], options);
    return (await this.log({ ...options, limit: 1 }))[0]!;
  }

  async checkout(target: string, options: MutationOptions = {}): Promise<void | OperationProposal> {
    if (options.pendingMode === "propose") return { operation: "checkout", arguments: { target }, summary: `Check out ${target}` };
    await this.git(["checkout", target], options);
  }

  async fetch(remote = "origin", options: MutationOptions = {}): Promise<void | OperationProposal> {
    if (options.pendingMode === "propose") return { operation: "fetch", arguments: { remote }, summary: `Fetch ${remote}` };
    await this.git(["fetch", "--progress", remote], options);
  }

  async pull(remote?: string, branch?: string, options: MutationOptions = {}): Promise<void | OperationProposal> {
    const args = [remote, branch].filter((value): value is string => Boolean(value));
    if (options.pendingMode === "propose") return { operation: "pull", arguments: { remote: remote ?? null, branch: branch ?? null }, summary: "Pull remote changes" };
    await this.git(["pull", "--ff-only", ...args], options);
  }

  async push(remote = "origin", branch?: string, options: MutationOptions = {}): Promise<void | OperationProposal> {
    if (options.pendingMode === "propose") return { operation: "push", arguments: { remote, branch: branch ?? null }, summary: `Push to ${remote}` };
    await this.git(["push", "--progress", remote, ...(branch ? [branch] : [])], options);
  }
}
