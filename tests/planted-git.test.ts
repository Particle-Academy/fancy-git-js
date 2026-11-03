// A same-named executable in the working directory must never run in place of
// git. Each block starts with a CONTROL that spawns the bare name in the same
// environment and requires the plant to fire: without it, a machine that does not
// search the cwd would pass every assertion here on vulnerable code. The ambient
// NoDefaultCurrentDirectoryInExePath is exactly that, so it is removed and the
// removal is asserted.
import { execFileSync, spawn } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProcessResult, ProcessRunner } from "../src/process.js";

const isWindows = process.platform === "win32";

function realGit(): string {
  // Deliberately not the code under test.
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    const candidate = join(dir, isWindows ? "git.exe" : "git");
    if ((isWindows ? /^[A-Za-z]:[\\/]/ : /^\//).test(dir) && existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  throw new Error("this suite needs a real git on PATH");
}

/** The bare-name spawn the library used to do. Exit code plus whatever it printed. */
function bareSpawn(args: string[]): Promise<{ code: number | null; stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { shell: false, windowsHide: true });
    let stdout = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout }));
  });
}

const markersIn = (dir: string) => readdirSync(dir).filter((file) => file.endsWith(".marker"));

let root = "";
let caseNumber = 0;
let saved: { cwd: string; env: NodeJS.ProcessEnv };
let gitPath = "";
let gitDir = "";

function scratch(): string {
  const dir = join(root, `case-${++caseNumber}`);
  mkdirSync(dir);
  return dir;
}

function initRepo(dir: string): void {
  execFileSync(gitPath, ["init", "-q", dir], { windowsHide: true, stdio: "ignore" });
}

async function freshRunner() {
  vi.resetModules();
  const { NodeProcessRunner } = await import("../src/process.js");
  const { GitRepository } = await import("../src/repository.js");
  return { NodeProcessRunner, GitRepository };
}

function setUpEnvironment(): void {
  saved = { cwd: process.cwd(), env: { ...process.env } };
  delete process.env.NoDefaultCurrentDirectoryInExePath;
  expect(process.env.NoDefaultCurrentDirectoryInExePath).toBeUndefined();
}

function restoreEnvironment(): void {
  process.chdir(saved.cwd);
  for (const key of Object.keys(process.env)) if (!(key in saved.env)) delete process.env[key];
  Object.assign(process.env, saved.env);
}

describe.skipIf(!isWindows)("a planted git.exe on Windows", () => {
  let plantBinary = "";

  /**
   * Node is the one real executable every run of this suite has. Under another
   * name, with the preload in NODE_OPTIONS, it is a plant. The tests call
   * `git version`, not `git --version`: node answers its own --version before
   * running a preload, so that form never fires the plant.
   */
  function plantExe(dir: string, name = "git.exe"): void {
    linkSync(plantBinary, join(dir, name));
  }

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "fancy-git-plant-"));
    plantBinary = join(root, "plant-binary.exe");
    copyFileSync(process.execPath, plantBinary);
    const script = join(root, "plant.cjs");
    writeFileSync(
      script,
      [
        'const { basename, dirname, join } = require("node:path");',
        "const self = basename(process.execPath).toLowerCase();",
        'if (self === "git.exe") {',
        '  require("node:fs").writeFileSync(join(dirname(process.execPath), "ran-" + self + ".marker"), "ran");',
        "  process.exit(7);",
        "}",
        "",
      ].join("\n"),
    );
    gitPath = realGit();
    gitDir = gitPath.slice(0, -"\\git.exe".length);
    process.env.__PLANT_OPTIONS = `--require "${script.replaceAll("\\", "/")}"`;
  });

  afterAll(() => {
    delete process.env.__PLANT_OPTIONS;
    rmSync(root, { recursive: true, force: true });
  });

  beforeEach(() => {
    setUpEnvironment();
    process.env.NODE_OPTIONS = process.env.__PLANT_OPTIONS;
  });

  afterEach(restoreEnvironment);

  it("runs the plant from the cwd under a bare name (control), and real git through the runner", async () => {
    const { NodeProcessRunner } = await freshRunner();
    const dir = scratch();
    plantExe(dir);
    process.chdir(dir);

    const control = await bareSpawn(["version"]);
    expect(control.code).toBe(7);
    expect(markersIn(dir)).toEqual(["ran-git.exe.marker"]);
    rmSync(join(dir, "ran-git.exe.marker"));

    const result = await new NodeProcessRunner().run("git", ["version"]);
    expect(result.stdout).toMatch(/^git version /);
    expect(markersIn(dir)).toEqual([]);
  });

  it("reads a repository holding a plant, from inside it, as the README's process.cwd() usage does", async () => {
    const { GitRepository } = await freshRunner();
    const dir = scratch();
    initRepo(dir);
    plantExe(dir);
    process.chdir(dir);

    const info = await new GitRepository(process.cwd()).info();
    expect(realpathSync.native(info.root)).toBe(realpathSync.native(dir));
    expect(markersIn(dir)).toEqual([]);
  });

  it.each([
    ["a dot", (git: string) => `.;${git}`],
    ["an empty entry", (git: string) => `;${git}`],
    ["a relative entry", (git: string) => `sub;${git}`],
  ])("does not search %s on PATH (control first)", async (_label, path) => {
    const { NodeProcessRunner } = await freshRunner();
    const dir = scratch();
    plantExe(dir);
    mkdirSync(join(dir, "sub"));
    plantExe(join(dir, "sub"));
    process.chdir(dir);
    process.env.PATH = path(gitDir);

    const control = await bareSpawn(["version"]);
    expect(control.code).toBe(7);
    rmSync(join(dir, "ran-git.exe.marker"), { force: true });
    rmSync(join(dir, "sub", "ran-git.exe.marker"), { force: true });

    const result = await new NodeProcessRunner().run("git", ["version"]);
    expect(result.stdout).toMatch(/^git version /);
    expect(markersIn(dir)).toEqual([]);
    expect(markersIn(join(dir, "sub"))).toEqual([]);
  });

  it("finds git in an absolute PATH entry, identified by the plant it runs there", async () => {
    const { NodeProcessRunner } = await freshRunner();
    const onPath = scratch();
    const cwd = scratch();
    plantExe(onPath);
    process.chdir(cwd);
    process.env.PATH = onPath;

    await expect(new NodeProcessRunner().run("git", ["version"])).rejects.toThrow();
    expect(markersIn(onPath)).toEqual(["ran-git.exe.marker"]);
    expect(markersIn(cwd)).toEqual([]);
  });

  it("fails closed when git is only in the cwd", async () => {
    const { NodeProcessRunner } = await freshRunner();
    const dir = scratch();
    plantExe(dir);
    process.chdir(dir);
    process.env.PATH = `${process.env.SystemRoot}\\System32`;

    const failure = await new NodeProcessRunner().run("git", ["version"]).catch((error) => error);
    expect(failure.code).toBe("not_found");
    expect(failure.message).toMatch(/current directory is never used/);
    expect(markersIn(dir)).toEqual([]);
  });

  it("says so clearly when git on PATH is only a batch file, and does not run it", async () => {
    const { NodeProcessRunner } = await freshRunner();
    const onPath = scratch();
    const cwd = scratch();
    writeFileSync(join(onPath, "git.cmd"), `@echo ran > "${join(onPath, "ran-git.cmd.marker")}"\r\n`);
    process.chdir(cwd);
    process.env.PATH = `${onPath};${process.env.SystemRoot}\\System32`;

    const failure = await new NodeProcessRunner().run("git", ["version"]).catch((error) => error);
    expect(failure.code).toBe("not_found");
    expect(failure.message).toMatch(/batch file/);
    expect(markersIn(onPath)).toEqual([]);
  });

  it("keeps the injected-runner seam: a host's runner receives the bare name and uses its own git", async () => {
    const { NodeProcessRunner, GitRepository } = await freshRunner();
    const dir = scratch();
    initRepo(dir);
    plantExe(dir);
    process.chdir(dir);
    process.env.PATH = "";

    const seen: string[] = [];
    const host: ProcessRunner = {
      run(command, args, options): Promise<ProcessResult> {
        seen.push(command);
        return new NodeProcessRunner().run(gitPath, args, options);
      },
    };

    const info = await new GitRepository(dir, host).info();
    expect(realpathSync.native(info.root)).toBe(realpathSync.native(dir));
    expect(new Set(seen)).toEqual(new Set(["git"]));
    expect(markersIn(dir)).toEqual([]);
  });
});

describe.skipIf(isWindows)("a planted git on POSIX", () => {
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "fancy-git-plant-"));
    gitPath = realGit();
    gitDir = gitPath.slice(0, -"/git".length);
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  beforeEach(setUpEnvironment);
  afterEach(restoreEnvironment);

  function plantScript(dir: string): void {
    const script = join(dir, "git");
    writeFileSync(script, '#!/bin/sh\necho ran > "$(dirname "$0")/ran-git.marker"\nexit 7\n');
    chmodSync(script, 0o755);
  }

  it("does not search a dot on PATH (control first)", async () => {
    const { NodeProcessRunner } = await freshRunner();
    const dir = scratch();
    plantScript(dir);
    process.chdir(dir);
    process.env.PATH = `.:${process.env.PATH}`;

    const control = await bareSpawn(["version"]);
    expect(control.code).toBe(7);
    rmSync(join(dir, "ran-git.marker"));

    const result = await new NodeProcessRunner().run("git", ["version"]);
    expect(result.stdout).toMatch(/^git version /);
    expect(markersIn(dir)).toEqual([]);
  });

  it("reads a normal repository", async () => {
    const { GitRepository } = await freshRunner();
    const dir = scratch();
    initRepo(dir);
    process.chdir(dir);

    const info = await new GitRepository(process.cwd()).info();
    expect(realpathSync.native(info.root)).toBe(realpathSync.native(dir));
  });

  it("fails closed when git is not on PATH", async () => {
    const { NodeProcessRunner } = await freshRunner();
    const dir = scratch();
    plantScript(dir);
    process.chdir(dir);
    process.env.PATH = ".";

    const failure = await new NodeProcessRunner().run("git", ["version"]).catch((error) => error);
    expect(failure.code).toBe("not_found");
    expect(markersIn(dir)).toEqual([]);
  });
});
