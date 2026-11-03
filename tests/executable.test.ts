// Runs on every platform, including Ubuntu CI: the PATH walk takes its platform
// and its file check as inputs. The cases are the same file in fancy-git-php and
// change-council, so a behaviour change has to be made in all three.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GitError } from "../src/errors.js";
import { findExecutable, isAbsoluteEntry, resolveExecutable } from "../src/executable.js";

interface LookupCase {
  name: string;
  platform: NodeJS.Platform;
  PATH: string;
  PATHEXT: string | null;
  files: string[];
  name_to_find: string;
  expect: { path: string | null; batch: string | null };
}

const cases = JSON.parse(
  readFileSync(new URL("./fixtures/executable-lookup-cases.json", import.meta.url), "utf8"),
) as LookupCase[];

describe("findExecutable", () => {
  it("has cases to run", () => {
    expect(cases.length).toBeGreaterThan(20);
  });

  it.each(cases.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    const files = new Set(c.files);
    const found = findExecutable(c.name_to_find, {
      platform: c.platform,
      env: { PATH: c.PATH, ...(c.PATHEXT === null ? {} : { PATHEXT: c.PATHEXT }) },
      isFile: (path) => files.has(path),
    });
    expect(found).toEqual(c.expect);
  });

  it("reads Path and Pathext in any case on Windows, as a host's own env object may spell them", () => {
    const found = findExecutable("git", {
      platform: "win32",
      env: { Path: "C:\\real", pathext: ".EXE" },
      isFile: (path) => path === "C:\\real\\git.EXE",
    });
    expect(found.path).toBe("C:\\real\\git.EXE");
  });

  it("does not read path in another case on POSIX, where they are different variables", () => {
    const found = findExecutable("git", {
      platform: "linux",
      env: { Path: "/usr/bin" },
      isFile: () => true,
    });
    expect(found.path).toBeNull();
  });

  it("checks real files by default", () => {
    const found = findExecutable("no-such-program-fancy-git", {});
    expect(found).toEqual({ path: null, batch: null });
  });
});

describe("isAbsoluteEntry", () => {
  it.each([
    ["C:\\x", "win32", true],
    ["c:/x", "win32", true],
    ["\\\\server\\share", "win32", true],
    ["//server/share", "win32", true],
    ["\\\\server", "win32", false],
    ["C:", "win32", false],
    ["C:x", "win32", false],
    ["\\x", "win32", false],
    ["/x", "win32", false],
    [".", "win32", false],
    ["", "win32", false],
    ["/usr/bin", "linux", true],
    ["C:\\x", "linux", false],
    [".", "linux", false],
    ["", "linux", false],
    ["bin", "linux", false],
  ] as const)("%s on %s is %s", (entry, platform, expected) => {
    expect(isAbsoluteEntry(entry, platform)).toBe(expected);
  });
});

describe("resolveExecutable", () => {
  const savedPath = process.env.PATH;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env.PATH = savedPath;
  });

  it("returns an absolute path as given, so a host can name its own git", () => {
    expect(resolveExecutable(process.execPath)).toBe(process.execPath);
  });

  it.each(["./git", "bin/git", "..\\git", "bin\\git"])("refuses the relative path %s", (name) => {
    expect(() => resolveExecutable(name)).toThrowError(GitError);
    try {
      resolveExecutable(name);
    } catch (error) {
      expect((error as GitError).code).toBe("invalid_argument");
    }
  });

  it("fails closed, with a clear error, when nothing is found", () => {
    process.env.PATH = "";
    let caught: unknown;
    try {
      resolveExecutable("no-such-program-fancy-git");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(GitError);
    expect((caught as GitError).code).toBe("not_found");
    expect((caught as GitError).message).toMatch(/current directory is never used/);
  });

  it("caches a success for the life of the process", async () => {
    const { resolveExecutable: fresh } = await import("../src/executable.js");
    const first = fresh("git");
    process.env.PATH = "";
    expect(fresh("git")).toBe(first);
  });

  it("does not cache a failure, so fixing PATH recovers without a restart", async () => {
    const { resolveExecutable: fresh } = await import("../src/executable.js");
    process.env.PATH = "";
    expect(() => fresh("git")).toThrowError(/Could not find/);
    process.env.PATH = savedPath;
    expect(fresh("git")).toMatch(/git/i);
  });
});
