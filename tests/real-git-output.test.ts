// Every public read method against what git really prints, in a real repository.
//
// The gap this closes: repository.test.ts feeds the parsers strings its author
// wrote, which only proves a parser agrees with its author about git's format.
// Text a commit carries could shift fields or add rows, and no test ever ran a
// commit through log() to notice.
//
// Expected values come from the commit() helper or a separate git call, never
// from the parser. Commands run with no global or system config, so a developer's
// core.quotePath or format settings cannot decide what is being tested.
// fancy-git-php's tests/RealGitOutputTest.php is the same suite for the PHP twin.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GitError } from "../src/errors.js";
import { GitRepository } from "../src/repository.js";
import { StubProcessRunner } from "../src/testing.js";
import type { Commit, WorkingTreeStatus } from "../src/types.js";

// One test can start dozens of git processes, which on Windows outruns the 5s default.
vi.setConfig({ testTimeout: 60_000 });

/** Not UTC: git versions differ on whether %aI spells that "Z" or "+00:00". */
const DATE = "2026-01-02T03:04:05+02:00";

/** For hand-built commits. Not "+0200": a plus starts a shifted run in UTF-7, and that conversion would fail. */
const STAMP = "1767315845 -0200";

const FS = "\x1f";
const RS = "\x1e";
const NUL = "\x00";

// By code point, so no tool on the way to this file can turn them into raw characters.
const NBSP = String.fromCharCode(0xa0);
const EM_SPACE = String.fromCharCode(0x2003);
const BOM = String.fromCharCode(0xfeff);
const CHECK_MARK = String.fromCharCode(0x2713);
const E_ACUTE = String.fromCharCode(0xe9);

// Set by a git hook or a developer's shell, and would redirect every command here.
const AMBIENT = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_AUTHOR_NAME",
  "GIT_AUTHOR_EMAIL",
  "GIT_AUTHOR_DATE",
  "GIT_COMMITTER_NAME",
  "GIT_COMMITTER_EMAIL",
  "GIT_COMMITTER_DATE",
];

let root = "";
let savedEnv: NodeJS.ProcessEnv;

beforeEach(() => {
  root = mkdtempSync(join(realpathSync.native(tmpdir()), "fancy-git-real-"));
  savedEnv = { ...process.env };
  for (const name of AMBIENT) delete process.env[name];
  process.env.GIT_CONFIG_GLOBAL = join(root, "no-such-gitconfig");
  process.env.GIT_CONFIG_NOSYSTEM = "1";
});

afterEach(() => {
  for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
  Object.assign(process.env, savedEnv);
  rmSync(root, { recursive: true, force: true, maxRetries: 5 });
});

/** Deliberately not the code under test: this is the test's own route to git. */
function git(cwd: string, args: string[], options: { mayFail?: boolean; input?: Buffer } = {}): string {
  try {
    return execFileSync("git", ["-C", cwd, ...args], {
      encoding: "utf8",
      input: options.input,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      env: { ...process.env, GIT_AUTHOR_DATE: DATE, GIT_COMMITTER_DATE: DATE },
    });
  } catch (error) {
    if (options.mayFail) return "";
    throw error;
  }
}

function repo(name: string): string {
  const dir = join(root, name);
  mkdirSync(dir);
  git(dir, ["init", "-q", "-b", "main"]);
  return dir;
}

function clone(from: string, name: string): string {
  const dir = join(root, name);
  git(root, ["clone", "-q", from, dir]);
  return dir;
}

/** @returns the new commit's full hash, read back from git */
function commit(dir: string, message: string, authorName = "Ada Lovelace", authorEmail = "ada@example.com"): string {
  git(dir, [
    "-c",
    `user.name=${authorName}`,
    "-c",
    `user.email=${authorEmail}`,
    "commit",
    "-q",
    "--allow-empty",
    "--allow-empty-message",
    "--cleanup=verbatim",
    "-m",
    message,
  ]);
  return git(dir, ["rev-parse", "HEAD"]).trim();
}

/** A commit object no porcelain would write, as a hostile repository can hold one. */
function rawCommit(dir: string, body: string): string {
  const tree = git(dir, ["hash-object", "-t", "tree", "-w", "--stdin"], { input: Buffer.alloc(0) }).trim();
  const id = git(dir, ["hash-object", "-t", "commit", "-w", "--stdin", "--literally"], {
    input: Buffer.from(`tree ${tree}\n${body}`, "latin1"),
  }).trim();
  git(dir, ["update-ref", "HEAD", id]);
  return id;
}

const subjects = (log: Commit[]) => log.map((entry) => entry.subject);

const sortedFiles = (status: WorkingTreeStatus) =>
  [...status.files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

describe("log() against real git", () => {
  it("parses every field of every record", async () => {
    const dir = repo("app");
    const first = commit(dir, "first commit");
    const second = commit(dir, "second commit", "Grace Hopper", "grace@example.com");

    const log = await new GitRepository(dir).log();

    expect(log).toHaveLength(2);
    expect(second.startsWith(log[0]!.shortId)).toBe(true);
    expect(log[0]!.shortId.length).toBeGreaterThanOrEqual(7);
    expect(log[0]).toEqual({
      id: second,
      shortId: log[0]!.shortId,
      parents: [first],
      authorName: "Grace Hopper",
      authorEmail: "grace@example.com",
      authoredAt: DATE,
      subject: "second commit",
    });
    expect(log[1]).toEqual({
      id: first,
      shortId: log[1]!.shortId,
      parents: [],
      authorName: "Ada Lovelace",
      authorEmail: "ada@example.com",
      authoredAt: DATE,
      subject: "first commit",
    });
  });

  it("returns both parents of a merge", async () => {
    const dir = repo("app");
    commit(dir, "base");
    git(dir, ["checkout", "-q", "-b", "side"]);
    const side = commit(dir, "on side");
    git(dir, ["checkout", "-q", "main"]);
    const main = commit(dir, "on main");
    git(dir, ["-c", "user.name=Ada", "-c", "user.email=ada@example.com", "merge", "-q", "--no-ff", "-m", "merge side", "side"]);

    const log = await new GitRepository(dir).log({ limit: 1 });

    expect(log[0]!.parents).toEqual([main, side]);
    expect(log[0]!.subject).toBe("merge side");
  });

  it("honours ref, limit and skip", async () => {
    const dir = repo("app");
    commit(dir, "one");
    commit(dir, "two");
    commit(dir, "three");
    git(dir, ["branch", "old", "HEAD~1"]);
    const repository = new GitRepository(dir);

    expect(subjects(await repository.log({ ref: "old" }))).toEqual(["two", "one"]);
    expect(subjects(await repository.log({ limit: 1 }))).toEqual(["three"]);
    expect(subjects(await repository.log({ limit: 1, skip: 1 }))).toEqual(["two"]);
  });

  it("is empty when git prints nothing", async () => {
    const dir = repo("app");
    commit(dir, "only");
    const repository = new GitRepository(dir);

    expect(await repository.log({ skip: 5 })).toEqual([]);
    expect(await repository.log({ limit: 0 })).toEqual([]);
  });

  // The characters a blanket trim() eats, the ones a parser might split on, and the
  // ones a shell or a format string would mangle.
  it("keeps a subject exactly as git reports it", async () => {
    const list = [
      "plain",
      "quotes \" and ' and `ticks`",
      "back\\slash, 100% %H %x1e | pipe; $HOME",
      `caf${E_ACUTE} ${CHECK_MARK} unicode`,
      "tab\tinside",
      "  leading spaces",
      "ends with a vertical tab\x0b",
      "ends with a form feed\x0c",
      `ends with a non-breaking space${NBSP}`,
      `ends with an em space${EM_SPACE}`,
      `ends with a byte order mark${BOM}`,
      `field${FS}separator${FS}inside`,
      `ends with the field separator${FS}`,
      `record${RS}separator${RS}inside`,
      `ends with the record separator${RS}`,
      "0",
    ];
    const dir = repo("app");
    for (const subject of list) commit(dir, subject);

    const log = await new GitRepository(dir).log();

    expect(subjects(log)).toEqual([...list].reverse());
    expect(log.map((entry) => git(dir, ["show", "-s", "--format=%s", entry.id]).slice(0, -1))).toEqual(subjects(log));
  });

  it("folds a multi-line subject and drops the body", async () => {
    const dir = repo("app");
    commit(dir, "before");
    commit(dir, `line one\nline two\n\nthe body${RS}\nmore body`);
    commit(dir, "after");

    expect(subjects(await new GitRepository(dir).log())).toEqual(["after", "line one line two", "before"]);
  });

  it("reads an empty commit message as an empty subject", async () => {
    const dir = repo("app");
    const id = commit(dir, "");

    const log = await new GitRepository(dir).log();

    expect(log).toHaveLength(1);
    expect(log[0]!.id).toBe(id);
    expect(log[0]!.subject).toBe("");
  });

  it("does not let a commit's text forge fields or records", async () => {
    const forged = "f".repeat(40);
    const dir = repo("app");
    const base = commit(dir, "base");
    const evil = commit(
      dir,
      `looks fine${RS}${forged}${FS}fff${FS}${FS}Forged${FS}forged@example.com${FS}2020-01-01T00:00:00+00:00${FS}forged commit`,
    );
    const shiftedName = `Eve${FS}spoof@example.com${FS}2020-01-01T00:00:00+00:00${FS}forged subject`;
    const named = commit(dir, "named", shiftedName);

    const log = await new GitRepository(dir).log();

    expect(log.map((entry) => entry.id)).toEqual([named, evil, base]);
    expect(log[0]!.subject).toBe("named");
    expect(log[0]!.authorEmail).toBe("ada@example.com");
    expect(log[0]!.authoredAt).toBe(DATE);
    expect(log[0]!.authorName).toBe(shiftedName);
    expect(log[1]!.authorName).toBe("Ada Lovelace");
    expect(log[1]!.subject).toContain(forged);
  });

  // The new record terminator is the separator plus a newline, so a subject
  // spelling exactly that is the next thing to try. git folds it onto one line.
  it.each([
    ["LF", "\n"],
    ["CRLF", "\r\n"],
  ])("does not let a subject spell the record terminator with %s", async (_label, newline) => {
    const dir = repo("app");
    const base = commit(dir, "base");
    const evil = commit(dir, `looks fine${RS}${newline}forged`);

    const log = await new GitRepository(dir).log();

    expect(log.map((entry) => entry.id)).toEqual([evil, base]);
    expect(log[0]!.subject).toBe(`looks fine${RS} forged`);
  });

  // A commit made by a porcelain cannot hold NUL, so the separator's safety is the
  // claim that git never prints one from a hand-built object either.
  it("does not let a hand-built commit object with NUL in it add a field", async () => {
    const dir = repo("app");
    const id = rawCommit(
      dir,
      `author Eve${NUL}spoof <eve@example.com> ${STAMP}\ncommitter Eve <eve@example.com> ${STAMP}\n\nsubject${NUL}hidden\n`,
    );

    const log = await new GitRepository(dir).log();

    expect(log).toHaveLength(1);
    expect(log[0]!.id).toBe(id);
    expect(JSON.stringify(log[0])).not.toContain("\\u0000");
    expect(log[0]!.subject).toBe("subject");
  });

  // git converts a commit with an `encoding` header before formatting it, so bytes
  // that are harmless in the object can become NUL or a newline only in the output.
  it("does not let a re-encoded commit object produce NUL or a record end in a field", async (context) => {
    const dir = repo("app");
    const encoded = (author: string, subject: string) =>
      `author ${author} <eve@example.com> ${STAMP}\ncommitter Eve <eve@example.com> ${STAMP}\nencoding UTF-7\n\n${subject}\n`;

    // The control: without it, a git that cannot convert UTF-7 prints these bytes
    // unchanged and every assertion below passes on nothing.
    rawCommit(dir, encoded("Eve", "control+AB4ACg-forged"));
    const [control] = await new GitRepository(dir).log();
    if (control!.subject.includes("+AB4ACg-")) return context.skip("this git cannot convert UTF-7");
    expect(control!.subject).toBe(`control${RS} forged`);

    for (const [author, subject] of [
      ["Eve+AAA-spoof", "subject+AAA-hidden"],
      ["Eve+AB4ACg-spoof", "subject+AB4ACg-spoof"],
    ] as const) {
      const id = rawCommit(dir, encoded(author, subject));

      const log = await new GitRepository(dir).log();

      expect(log).toHaveLength(1);
      expect(log[0]!.id).toBe(id);
      expect(JSON.stringify(log[0])).not.toContain("\\u0000");
    }
  });

  it("keeps separators a hand-built commit puts at the end of each field", async () => {
    const dir = repo("app");
    const id = rawCommit(
      dir,
      `author Eve${RS} <e${RS}@example.com> ${STAMP}\ncommitter Eve <eve@example.com> ${STAMP}\n\nsubject${RS}\n`,
    );

    const log = await new GitRepository(dir).log();

    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ id, authorName: `Eve${RS}`, authorEmail: `e${RS}@example.com`, subject: `subject${RS}` });
  });

  // Pinned, not endorsed: an unborn HEAD is a typed failure from git itself, the
  // same as fancy-git-php. Whether it should be an empty list is a separate decision.
  it("is a typed failure on a repository with no commits", async () => {
    const failure = await new GitRepository(repo("empty")).log().catch((error) => error);

    expect(failure).toBeInstanceOf(GitError);
    expect(failure.exitCode).not.toBe(0);
  });

  it("commit() returns the commit it made, read through log()", async () => {
    const dir = repo("app");
    writeFileSync(join(dir, "a.txt"), "a\n");
    const repository = new GitRepository(dir);
    await repository.stage(["a.txt"]);
    git(dir, ["config", "user.name", "Ada Lovelace"]);
    git(dir, ["config", "user.email", "ada@example.com"]);

    const made = await repository.commit("made here");

    expect(made).toMatchObject({
      id: git(dir, ["rev-parse", "HEAD"]).trim(),
      authorName: "Ada Lovelace",
      authorEmail: "ada@example.com",
      subject: "made here",
    });
  });
});

describe("branches() against real git", () => {
  it("parses local branches", async () => {
    const dir = repo("app");
    const first = commit(dir, "first");
    const second = commit(dir, "second");
    git(dir, ["branch", "feature/nested-name", first]);

    expect(await new GitRepository(dir).branches()).toEqual([
      { name: "feature/nested-name", current: false, remote: false, target: first },
      { name: "main", current: true, remote: false, target: second },
    ]);
  });

  it("reports upstream and remote refs", async () => {
    const origin = repo("origin");
    const head = commit(origin, "first");
    git(origin, ["branch", "other"]);
    const dir = clone(origin, "clone");
    git(dir, ["branch", "solo"]);

    const branches = new Map((await new GitRepository(dir).branches()).map((branch) => [branch.name, branch]));

    expect(branches.get("main")).toEqual({ name: "main", current: true, remote: false, target: head, upstream: "origin/main" });
    expect(branches.get("solo")).toEqual({ name: "solo", current: false, remote: false, target: head });
    expect(branches.get("origin/main")).toEqual({ name: "origin/main", current: false, remote: true, target: head });
    expect(branches.get("origin/other")).toEqual({ name: "origin/other", current: false, remote: true, target: head });
  });

  it("marks none current on a detached HEAD", async () => {
    const dir = repo("app");
    commit(dir, "first");
    git(dir, ["checkout", "-q", "--detach"]);

    const branches = await new GitRepository(dir).branches();

    expect(branches.map((branch) => branch.name)).toEqual(["main"]);
    expect(branches[0]!.current).toBe(false);
  });

  it("is empty on a repository with no commits", async () => {
    expect(await new GitRepository(repo("empty")).branches()).toEqual([]);
  });

  // branches() keeps its control-character separator because of this rule of git's.
  it("relies on git refusing a ref name holding the separators", () => {
    const dir = repo("app");
    const head = commit(dir, "first");

    for (const separator of [FS, RS]) {
      expect(() => git(dir, ["update-ref", `refs/heads/a${separator}b`, head])).toThrow();
    }
  });
});

describe("what the record split must survive", () => {
  const logRecord = (id: string, subject: string) => ["" + id, "s" + id, "", "n", "e", "d", subject].join(NUL);
  const refRecord = (name: string) => [name, " ", "abc", "", `refs/heads/${name}`].join(FS);

  it("splits on CRLF as well as LF", async () => {
    const log = `${logRecord("a", "one")}${RS}\r\n${logRecord("c", "two")}${RS}\r\n`;
    const refs = `${refRecord("main")}${RS}\r\n${refRecord("old")}${RS}\r\n`;

    expect(subjects(await new GitRepository(".", new StubProcessRunner([log])).log())).toEqual(["one", "two"]);
    expect((await new GitRepository(".", new StubProcessRunner([refs])).branches()).map((b) => b.name)).toEqual(["main", "old"]);
  });

  it("accepts a final record without its newline", async () => {
    const log = `${logRecord("a", "one")}${RS}\n${logRecord("c", "two")}${RS}`;

    expect(subjects(await new GitRepository(".", new StubProcessRunner([log])).log())).toEqual(["one", "two"]);
  });

  it("does not eat a subject's own separator at the end of a record", async () => {
    const log = `${logRecord("a", `one${RS}`)}${RS}\r\n${logRecord("c", `two${RS}`)}${RS}`;

    expect(subjects(await new GitRepository(".", new StubProcessRunner([log])).log())).toEqual([`one${RS}`, `two${RS}`]);
  });

  it("keeps any further separator in the last field", async () => {
    const log = `${logRecord("a", `one${NUL}more`)}${RS}\n`;

    expect(subjects(await new GitRepository(".", new StubProcessRunner([log])).log())).toEqual([`one${NUL}more`]);
  });

  it.each([
    ["a stray newline", "\n"],
    ["text with no separators", `not a record${RS}\n`],
    ["the old separators", ["a", "b", "", "n", "e", "d", "s"].join(FS) + `${RS}\n`],
  ])("makes %s a typed failure in log()", async (_label, output) => {
    const failure = await new GitRepository(".", new StubProcessRunner([output])).log().catch((error) => error);

    expect(failure).toBeInstanceOf(GitError);
    expect(failure.code).toBe("unknown");
    expect(failure.message).toMatch(/Unexpected git output: expected 7 fields/);
  });

  it.each([
    ["a stray newline", "\n"],
    ["text with no separators", `not a record${RS}\n`],
  ])("makes %s a typed failure in branches()", async (_label, output) => {
    const failure = await new GitRepository(".", new StubProcessRunner([output])).branches().catch((error) => error);

    expect(failure).toBeInstanceOf(GitError);
    expect(failure.code).toBe("unknown");
    expect(failure.message).toMatch(/Unexpected git output: expected 5 fields/);
  });

  it("treats no output as no records", async () => {
    expect(await new GitRepository(".", new StubProcessRunner([""])).log()).toEqual([]);
    expect(await new GitRepository(".", new StubProcessRunner([""])).branches()).toEqual([]);
  });
});

describe("status() against real git", () => {
  const renameable = "content that is long enough to be detected as a rename\n";

  it("of a clean repository", async () => {
    const dir = repo("app");
    commit(dir, "first");

    expect(await new GitRepository(dir).status()).toEqual({
      branch: "main",
      upstream: null,
      ahead: 0,
      behind: 0,
      files: [],
      clean: true,
    });
  });

  it("of a repository with no commits", async () => {
    const dir = repo("empty");
    writeFileSync(join(dir, "new.txt"), "x\n");

    const status = await new GitRepository(dir).status();

    expect(status.branch).toBe("main");
    expect(status.clean).toBe(false);
    expect(status.files).toEqual([{ path: "new.txt", index: null, worktree: "untracked" }]);
  });

  it("reports staged, unstaged, deleted and untracked files", async () => {
    const dir = repo("app");
    writeFileSync(join(dir, "staged.txt"), "1\n");
    writeFileSync(join(dir, "unstaged.txt"), "1\n");
    writeFileSync(join(dir, "removed.txt"), "1\n");
    git(dir, ["add", "."]);
    commit(dir, "first");
    writeFileSync(join(dir, "staged.txt"), "2\n");
    git(dir, ["add", "staged.txt"]);
    writeFileSync(join(dir, "unstaged.txt"), "2\n");
    unlinkSync(join(dir, "removed.txt"));
    writeFileSync(join(dir, "with space.txt"), "new\n");
    writeFileSync(join(dir, `caf${E_ACUTE}.txt`), "new\n");

    const status = await new GitRepository(dir).status();

    expect(status.clean).toBe(false);
    expect(sortedFiles(status)).toEqual([
      { path: `caf${E_ACUTE}.txt`, index: null, worktree: "untracked" },
      { path: "removed.txt", index: null, worktree: "deleted" },
      { path: "staged.txt", index: "modified", worktree: null },
      { path: "unstaged.txt", index: null, worktree: "modified" },
      { path: "with space.txt", index: null, worktree: "untracked" },
    ]);
  });

  it("reports a rename with its previous path", async () => {
    const dir = repo("app");
    writeFileSync(join(dir, "old name.txt"), renameable);
    git(dir, ["add", "."]);
    commit(dir, "first");
    git(dir, ["mv", "old name.txt", "new name.txt"]);

    expect((await new GitRepository(dir).status()).files).toEqual([
      { path: "new name.txt", index: "renamed", worktree: null, previousPath: "old name.txt" },
    ]);
  });

  // The PHP twin lost a file here, because array_filter() also drops the string "0".
  // A JavaScript "0" is truthy, so this package never did. Pinned so the two agree.
  it("keeps a rename from a file named 0", async () => {
    const dir = repo("app");
    writeFileSync(join(dir, "0"), renameable);
    git(dir, ["add", "."]);
    commit(dir, "first");
    git(dir, ["mv", "0", "renamed.txt"]);
    writeFileSync(join(dir, "z-added.txt"), "something else entirely\n");
    git(dir, ["add", "z-added.txt"]);

    expect(sortedFiles(await new GitRepository(dir).status())).toEqual([
      { path: "renamed.txt", index: "renamed", worktree: null, previousPath: "0" },
      { path: "z-added.txt", index: "added", worktree: null },
    ]);
  });

  it("keeps a rename to a file named 0, and an untracked one", async () => {
    const dir = repo("app");
    writeFileSync(join(dir, "first.txt"), renameable);
    git(dir, ["add", "."]);
    commit(dir, "first");
    git(dir, ["mv", "first.txt", "0"]);
    mkdirSync(join(dir, "sub"));
    writeFileSync(join(dir, "sub", "0"), "x\n");

    expect(sortedFiles(await new GitRepository(dir).status())).toEqual([
      { path: "0", index: "renamed", worktree: null, previousPath: "first.txt" },
      { path: "sub/", index: null, worktree: "untracked" },
    ]);

    git(dir, ["mv", "0", "first.txt"]);
    rmSync(join(dir, "sub"), { recursive: true });
    writeFileSync(join(dir, "0"), "x\n");

    expect((await new GitRepository(dir).status()).files).toEqual([{ path: "0", index: null, worktree: "untracked" }]);
  });

  it("reports a merge conflict", async () => {
    const dir = repo("app");
    writeFileSync(join(dir, "conflict me.txt"), "base\n");
    git(dir, ["add", "."]);
    commit(dir, "base");
    git(dir, ["checkout", "-q", "-b", "side"]);
    writeFileSync(join(dir, "conflict me.txt"), "side\n");
    git(dir, ["add", "."]);
    commit(dir, "side");
    git(dir, ["checkout", "-q", "main"]);
    writeFileSync(join(dir, "conflict me.txt"), "main\n");
    git(dir, ["add", "."]);
    commit(dir, "main");
    git(dir, ["-c", "user.name=Ada", "-c", "user.email=ada@example.com", "merge", "-q", "side"], { mayFail: true });

    expect((await new GitRepository(dir).status()).files).toEqual([
      { path: "conflict me.txt", index: "conflicted", worktree: "conflicted" },
    ]);
  });

  it("reports upstream, ahead and behind", async () => {
    const origin = repo("origin");
    commit(origin, "first");
    const dir = clone(origin, "clone");
    commit(dir, "local one");
    commit(dir, "local two");
    commit(origin, "remote one");
    git(dir, ["fetch", "-q", "origin"]);

    expect(await new GitRepository(dir).status()).toMatchObject({ branch: "main", upstream: "origin/main", ahead: 2, behind: 1 });
  });

  it("has no branch on a detached HEAD", async () => {
    const dir = repo("app");
    commit(dir, "first");
    git(dir, ["checkout", "-q", "--detach"]);

    expect((await new GitRepository(dir).status()).branch).toBeNull();
  });
});

describe("info() against real git", () => {
  it("of a repository with commits", async () => {
    const dir = repo("app");
    const head = commit(dir, "first");

    const info = await new GitRepository(dir).info();

    expect(realpathSync.native(info.root)).toBe(realpathSync.native(dir));
    expect(info).toMatchObject({ branch: "main", head, bare: false });
  });

  it("of a repository with no commits has no head", async () => {
    expect(await new GitRepository(repo("empty")).info()).toMatchObject({ branch: "main", head: null });
  });

  it("has no branch on a detached HEAD", async () => {
    const dir = repo("app");
    const head = commit(dir, "first");
    git(dir, ["checkout", "-q", "--detach"]);

    expect(await new GitRepository(dir).info()).toMatchObject({ branch: null, head });
  });
});

describe("diff() against real git", () => {
  it("of the worktree, the index and two refs", async () => {
    const dir = repo("app");
    writeFileSync(join(dir, "tracked.txt"), "one\n");
    writeFileSync(join(dir, "other.txt"), "one\n");
    git(dir, ["add", "."]);
    commit(dir, "first");
    writeFileSync(join(dir, "tracked.txt"), "two\n");
    git(dir, ["add", "."]);
    commit(dir, "second");
    writeFileSync(join(dir, "tracked.txt"), "three\n");
    writeFileSync(join(dir, "other.txt"), "staged\n");
    git(dir, ["add", "other.txt"]);
    const repository = new GitRepository(dir);

    const worktree = await repository.diff();
    expect(worktree.files).toEqual(["tracked.txt"]);
    expect(worktree.patch).toContain("-two\n+three\n");

    const staged = await repository.diff({ staged: true });
    expect(staged.files).toEqual(["other.txt"]);
    expect(staged.patch).toContain("-one\n+staged\n");

    const range = await repository.diff({ from: "HEAD~1", to: "HEAD" });
    expect(range.files).toEqual(["tracked.txt"]);
    expect(range.patch).toContain("-one\n+two\n");

    expect((await repository.diff({ paths: ["tracked.txt"] })).files).toEqual(["tracked.txt"]);
    expect((await repository.diff({ paths: ["other.txt"] })).files).toEqual([]);
  });

  it("lists every file, including renames and binaries", async () => {
    const dir = repo("app");
    writeFileSync(join(dir, "old.txt"), "content that is long enough to be detected as a rename\n");
    writeFileSync(join(dir, "blob.bin"), Buffer.from([0, 1, 2]));
    git(dir, ["add", "."]);
    commit(dir, "first");
    git(dir, ["mv", "old.txt", "new.txt"]);
    writeFileSync(join(dir, "blob.bin"), Buffer.from([0, 3, 4]));
    git(dir, ["add", "."]);

    const diff = await new GitRepository(dir).diff({ staged: true });

    expect([...diff.files].sort()).toEqual(["blob.bin", "new.txt"]);
    expect(diff.patch).toContain("GIT binary patch");
  });

  it("is empty when nothing changed", async () => {
    const dir = repo("app");
    commit(dir, "first");

    expect(await new GitRepository(dir).diff()).toEqual({ patch: "", files: [] });
  });

  it("is empty on a repository with no commits", async () => {
    expect(await new GitRepository(repo("empty")).diff()).toEqual({ patch: "", files: [] });
  });
});
